import type { Db } from './db';
import { addDays, daysOfMonth, editFrom } from './meals';
import { toPoisha } from './money';
import { loadMonth, monthOf, type Actor } from './money-db';

export type Cash = { cash: number; bkash: number; nagad: number; bank: number };
export type CloseResult = 'ok' | 'closed' | 'early' | 'order' | 'pending' | 'problems' | 'cash' | 'changed' | 'notCollector';
export const CASH_KEYS = ['cash', 'bkash', 'nagad', 'bank'] as const;

const nextMonth = (month: string) => addDays(daysOfMonth(month).at(-1)!, 1);

/** The four cash boxes as typed: empty is 0, otherwise an amount like any entry (0 allowed). Null if any box is wrong. */
export function parseCash(raw: Record<keyof Cash, string>): Cash | null {
  const out = {} as Cash;
  for (const k of CASH_KEYS) {
    const v = (raw[k] ?? '').replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[,\s৳]/g, '');
    const p = v === '' || /^0+(\.0+)?$/.test(v) ? 0 : toPoisha(v);
    if (p === null) return null;
    out[k] = p;
  }
  return out;
}

/** First day meals and money may still change: never before last month (editFrom), never inside a closed month. */
export async function openFrom(db: Db, flatId: string, today: string) {
  const [r] = await db<{ m: string | null }>(`select max(month)::text as m from months where flat_id = $1 and status = 'closed'`, [flatId]);
  const after = r.m ? nextMonth(r.m) : null, from = editFrom(today);
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
  return { month, fund: mo.result.fund, pending: mo.entries.filter(x => x.status === 'pending').length,
    problems: mo.result.problems.length, earlierOpen: mo.earlierOpen };
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
  const mo = await loadMonth(db, flatId, month, today);
  const expected = mo.result.fund;
  if (!mo.info || mo.earlierOpen) return out('order', expected);
  if (mo.info.status === 'closed') return out('closed', expected);
  if (mo.entries.some(x => x.status === 'pending')) return out('pending', expected);
  if (!mo.result.invariantOk) return out('problems', expected);
  if (actual !== expected) return out('cash', expected);
  await afterLoad?.();
  const record = { ...cash, expected, actual, difference: actual - expected, by: by.memberId };
  const rows = mo.result.perMember.map(p => ({ ...p, meals: mo.meals.get(p.id) ?? 0, days: mo.days.get(p.id) ?? 0 }));
  const r = await db(
    `with m as (update months set status = 'closed', closing_fund = $4, meal_rate = $5, cash_counted = $6, cash = $7::text::jsonb, closed_at = now()
         where flat_id = $1 and month = $2::date and status = 'open' and version = $3
           and exists (select 1 from members where flat_id = $1 and id = $8 and role = 'manager')
           and not exists (select 1 from months e where e.flat_id = $1 and e.month < $2::date and e.status = 'open')
           and not exists (select 1 from ledger where flat_id = $1 and month = $2::date and status = 'pending')
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
