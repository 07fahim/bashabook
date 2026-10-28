import { createHash } from 'node:crypto';
import { blocksClose } from './bazar';
import type { Db } from './db';
import { addDays, daysOfMonth, editFrom } from './meals';
import { CASH_KEYS, parseCash, type Cash } from './money';
import { flatMoney } from './handover';
import { addEntry, loadMonth, monthOf, openMonth, type Actor } from './money-db';
import { history, worthALook } from './charts';

export { CASH_KEYS, parseCash, type Cash };   // pure, in money.ts so the close card can use them in the browser

export type CloseResult = 'ok' | 'closed' | 'early' | 'order' | 'pending' | 'problems' | 'cash' | 'changed' | 'notCollector';

const nextMonth = (month: string) => addDays(daysOfMonth(month).at(-1)!, 1);

/** First day of the oldest open month: the day after the latest closed month; null when none has closed (all are open). */
export async function openStart(db: Db, flatId: string) {
  const [r] = await db<{ m: string | null }>(`select max(month)::text as m from months where flat_id = $1 and status = 'closed'`, [flatId]);
  return r.m ? nextMonth(r.m) : null;
}

/** First day meals and money may still change: never before last month (editFrom), never inside a closed month. */
export async function openFrom(db: Db, flatId: string, today: string) {
  const after = await openStart(db, flatId), from = editFrom(today);
  return after && after > from ? after : from;
}

/** The oldest open month that has ended: the only one that can close next. */
export async function closableMonth(db: Db, flatId: string, today: string) {
  const [r] = await db<{ m: string }>(
    `select month::text as m from months where flat_id = $1 and status = 'open' and month < $2::date order by month limit 1`, [flatId, monthOf(today)]);
  return r?.m ?? null;
}

/** What the close card needs: the month, the fund the cash must match, and what blocks it. */
export async function closeInfo(db: Db, flatId: string, today: string) {
  const month = await closableMonth(db, flatId, today);
  if (!month) return null;
  const mo = await loadMonth(db, flatId, month, today);
  // the count covers the later open months too, so an entry still waiting there (money handed over or received, not yet
  // tapped) blocks it as well: it is in the hand but not in the books; and a bazar or bill of this month not yet Verified.
  // `pendingMonth`: where to go and fix the first one
  const [total, [p], past] = await Promise.all([flatMoney(db, flatId, today), db<{ n: number; m: string | null }>(
    `select count(*)::int as n, min(month)::text as m from ledger where flat_id = $1 and month >= $2::date and ${blocksClose('$2::date')}`, [flatId, month]),
    history(db, flatId, month)]);
  const fund = mo.result.fund;
  // `later`: what the months after it added or spent since, so the card can say why the count differs from its own fund
  // questions about the month, never blockers: after the close only a correction can mend a twin or a bill that never came
  const looks = worthALook(mo.entries, past, today, true);
  return { month, fund, held: cashFrom(fund, total), later: total - fund, pending: p.n, pendingMonth: p.m ?? month,
    problems: mo.result.problems.length, looks };
}

/** The cash the collector must count to close a month whose own fund is `fund`, when every open month together holds `total`
 *  (flatMoney). After the 1st they also hold the later months' money, so it is the total, never below ৳0: spending past that
 *  came from their own pocket and is a debt to them, not cash. A month whose own fund is below 0 can't be counted at all:
 *  its gap is paid first (coverGap). */
const cashFrom = (fund: number, total: number) => (fund < 0 ? fund : Math.max(0, total));

/** The same id for the same month state: sha256 of (flat, month, version) shaped as a version-5 style UUID. */
const gapId = (flatId: string, month: string, version: number) => {
  const h = createHash('sha256').update(`${flatId}:${month}:${version}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** The collector spent more for the flat than flat money held (fund below 0): records their own deposit of exactly the gap,
 *  dated the month's last day, so the closable month's fund is 0 and the flat owes them that much. The amount is always
 *  recomputed here: `shown` (what the collector confirmed) only has to match it, else 'changed' and nothing is recorded. The id comes from the month's state, so two tabs (or two taps) that saw the same state record once;
 *  with nothing left to cover it does nothing. */
export async function coverGap(db: Db, flatId: string, by: Actor, today: string, note: string, shown: number): Promise<'ok' | 'bad' | 'changed'> {
  const month = by.role === 'manager' ? await closableMonth(db, flatId, today) : null;
  if (!month) return 'bad';
  const mo = await loadMonth(db, flatId, month, today), fund = mo.result.fund;
  if (fund >= 0 || !mo.info) return 'ok';
  if (mo.entries.some(x => x.status === 'pending') || !mo.result.invariantOk) return 'bad';   // this month's own blockers; closeMonth checks later months too
  if (-fund !== shown) return 'changed';
  return (await addEntry(db, flatId, by, { id: gapId(flatId, month, mo.info.version), type: 'deposit', amount: -fund,
    date: daysOfMonth(month).at(-1)!, note, paidBy: null, memberId: by.memberId, split: null, selected: [] })) in { ok: 1, again: 1 } ? 'ok' : 'bad';
}

/** Saves every missing meal row of an open `month` as the calendar shows it now: a saved row stays as it is, a no-cooking
 *  meal is 0, otherwise the person's usual meal, on the days they lived here. A closed month's days with no row would
 *  otherwise follow later usual-meals changes while its bill stays frozen (Plan 6c). It can't run inside the close statement:
 *  the closed-month trigger sees the month closed by then and refuses the write. So it runs just before; if the close then
 *  fails the rows stay, which is safe only because each equals what the calendar and bill already compute. Every inserted
 *  row bumps the month's version (trigger), so a close prepared before it is refused. Returns the rows inserted. */
export async function freezeMonth(db: Db, flatId: string, month: string): Promise<number> {
  const end = daysOfMonth(month).at(-1)!;
  return (await db(
    `insert into meal_changes (flat_id, member_id, date, meal, count)
     select m.flat_id, m.id, d::date, x,
       case when exists (select 1 from no_cook n where n.flat_id = m.flat_id and n.date = d::date and n.meal = x) then 0
            else (case x when 'b' then m.default_b when 'l' then m.default_l else m.default_d end)::int end
     from members m,
       generate_series(greatest(m.joined_on, $2::text::date)::timestamp, least(coalesce(m.left_on, $3::text::date), $3::text::date)::timestamp, interval '1 day') d,
       unnest(array['b','l','d']) x
     where m.flat_id = $1 and exists (select 1 from months where flat_id = $1 and month = $2::text::date and status = 'open')
     on conflict (member_id, date, meal) do nothing
     returning 1`, [flatId, month, end])).length;
}

/** Closes a month. The version is read first (inside loadMonth), then the engine runs, then one statement closes the
 *  month only if nothing moved its version since: a write still running holds the month row, so this statement waits for
 *  it, re-checks, sees the new version and closes nothing. Two taps: the second finds 'closed'. `today` is the server's
 *  Dhaka date (todayDhaka() in the action); `afterLoad` exists only for tests. */
export async function closeMonth(db: Db, flatId: string, by: Actor, month: string, today: string, cash: Cash,
  afterLoad?: () => Promise<void>): Promise<{ result: CloseResult; expected: number; actual: number }> {
  const actual = cash.cash + cash.bkash + cash.nagad + cash.bank;
  const out = (result: CloseResult, expected = 0) => ({ result, expected, actual });
  if (by.role !== 'manager') return out('notCollector');
  if (today < nextMonth(month)) return out('early');
  await freezeMonth(db, flatId, month);
  const mo = await loadMonth(db, flatId, month, today);
  const expected = mo.result.fund;
  if (!mo.info || mo.earlierOpen) return out('order', expected);
  if (mo.info.status === 'closed') return out('closed', expected);
  // pending money in this or a later open month is in the hand but not in the books, so the count can't come out right: the
  // close card blocks on it (closeInfo), and so does the statement below, whatever the card showed when it was opened; and a
  // bazar or bill of this month not yet Verified
  const [p] = await db<{ n: number }>(`select count(*)::int as n from ledger where flat_id = $1 and month >= $2::date and ${blocksClose('$2::date')}`, [flatId, month]);
  if (p.n > 0) return out('pending', expected);
  if (!mo.result.invariantOk) return out('problems', expected);
  // ponytail: the count is checked against later open months too, but only this month's version guards the close; an entry
  // landing in a later month mid-close can't change what is frozen here, only make this check slightly stale
  const held = cashFrom(expected, await flatMoney(db, flatId, today));
  if (actual !== held) return out('cash', held);
  await afterLoad?.();
  // expected: the cash it was counted against (everything held then); closes before Plan 7 stored the month's own fund here
  const record = { ...cash, expected: held, actual, difference: actual - held, by: by.memberId };
  const rows = mo.result.perMember.map(p => ({ ...p, meals: mo.meals.get(p.id) ?? 0, days: mo.days.get(p.id) ?? 0 }));
  const r = await db(
    `with m as (update months set status = 'closed', closing_fund = $4, meal_rate = $5, cash_counted = $6, cash = $7::text::jsonb, closed_at = now()
         where flat_id = $1 and month = $2::date and status = 'open' and version = $3
           and exists (select 1 from members where flat_id = $1 and id = $8 and role = 'manager')
           and not exists (select 1 from months e where e.flat_id = $1 and e.month < $2::date and e.status = 'open')
           and not exists (select 1 from ledger where flat_id = $1 and month >= $2::date and ${blocksClose('$2::date')})
         returning month),
       b as (insert into month_balances (flat_id, month, member_id, weighted_meals, days_present, opening, paid_in, food_cost, bill_share, payouts, adjustments, balance)
         select $1, m.month, (x->>'id')::uuid, (x->>'meals')::int, (x->>'days')::int, (x->>'opening')::bigint, (x->>'paidIn')::bigint,
           (x->>'foodCost')::bigint, (x->>'billShare')::bigint, (x->>'payouts')::bigint, (x->>'adjustments')::bigint, (x->>'balance')::bigint
         from m, jsonb_array_elements($9::text::jsonb) x)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'months', $2::date::text, $7::text::jsonb, $8 from m returning 1`,
    [flatId, month, mo.info.version, expected, mo.result.mealRate, actual, JSON.stringify(record), by.memberId, JSON.stringify(rows)]);
  if (r.length) return out('ok', expected);
  const [now] = await db<{ status: string }>(`select status from months where flat_id = $1 and month = $2`, [flatId, month]);
  return out(now?.status === 'closed' ? 'closed' : 'changed', expected);
}

export type Correction = { id: string; forMonth: string; amount: number; note: string } & (
  | { kind: 'bazar'; paidBy: string }
  | { kind: 'bill'; paidBy: string; split: 'meals' | 'equal' | 'selected'; selected: string[] }
  | { kind: 'move'; from: string; to: string });

/** A fix for a closed month, booked in this month. Never touches the fund: a cost someone paid from their own pocket
 *  (split later by that month's frozen meals or days), or a move between two people. Only the collector; a reason is required;
 *  every person must have lived here in that month. One statement; a retry with the same id records nothing new. */
export async function addCorrection(db: Db, flatId: string, by: Actor, c: Correction, today: string): Promise<'ok' | 'bad' | 'month'> {
  const note = c.note.trim();
  if (by.role !== 'manager' || !note || note.length > 100 || !Number.isInteger(c.amount) || c.amount <= 0) return 'bad';
  const move = c.kind === 'move';
  if (move && c.from === c.to) return 'bad';
  if (c.kind === 'bill' && c.split === 'selected' && !c.selected.length) return 'bad';
  const selected = c.kind === 'bill' && c.split === 'selected' ? c.selected : [];
  const people = move ? [c.from, c.to] : [c.paidBy, ...selected];
  if (people.some(p => !p)) return 'bad';   // a cost with no payer would come out of flat money
  // the frozen weights the cost is split by must not all be 0, else nobody would pay it ('selected': the people are checked below)
  const weigh = move || selected.length ? null : c.kind === 'bill' && c.split === 'equal' ? 'days' : 'meals';
  await openMonth(db, flatId, monthOf(today));   // the correction is booked in this month
  const r = await db(
    `with ok as (select 1 from months where flat_id = $1 and month = $2::date and status = 'closed'
         and (select count(distinct member_id) from month_balances where flat_id = $1 and month = $2::date and days_present > 0
              and member_id in (select json_array_elements_text($3::text::json)::uuid)) = (select count(distinct x) from json_array_elements_text($3::text::json) x)
         and ($15::text is null or (select sum(case when $15::text = 'days' then days_present else weighted_meals end) from month_balances
              where flat_id = $1 and month = $2::date) > 0)),
       l as (insert into ledger (id, flat_id, month, type, amount_poisha, paid_by_member_id, member_id, moves, split, date, note, status, created_by, for_month)
         select $4::uuid, $1, date_trunc('month', $5::date)::date, $6, $7, $8::uuid, $9::uuid, $10::uuid, $11, $5::date, $12, 'ok', $13, $2::date from ok
         on conflict (id) do nothing returning *),
       s as (insert into bill_split_members (flat_id, ledger_id, member_id) select $1, l.id, x::uuid from l, json_array_elements_text($14::text::json) x)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text, to_jsonb(l), $13 from l returning 1`,
    [flatId, c.forMonth, JSON.stringify(people), c.id, today, move ? 'adjustment' : c.kind, c.amount,
     move ? null : c.paidBy, move ? c.from : null, move ? c.to : null, c.kind === 'bill' ? c.split : null, note, by.memberId, JSON.stringify(selected), weigh]);
  if (r.length) return 'ok';
  // a retry finds its own row; anything else means the month or the people were wrong
  return (await db(`select 1 from ledger where flat_id = $1 and id = $2`, [flatId, c.id])).length ? 'ok' : 'month';
}
