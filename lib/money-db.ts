import { itemsOk, type Item } from './bazar';
import type { Db } from './db';
import { daysOfMonth, daysPresent, isPresent, weightedMeals } from './meals';
import { loadMeals } from './meals-db';
import { CASH_KEYS, monthBalances, type LedgerRow, type MonthResult, type Split } from './money';
import { isJpeg, MAX_RECEIPT } from './photo';

export type Entry = LedgerRow & { date: string; note: string | null; createdBy: string; forMonth: string | null; moves: string | null; heldBy: string | null; method: Method | null;
  check: 'ok' | 'fix' | null; receiptV: string | null;   // 020: null check = waiting; receiptV: the receipt's ?v= (null = none)
  notJoined: boolean };   // counted at once because the other person hadn't joined yet (marked in its first history row)
/** How money in or out was paid (019): the same four places the close card counts. */
export type Method = (typeof CASH_KEYS)[number];
export type CashRecord = { cash: number; bkash: number; nagad: number; bank: number; expected: number; actual: number; difference: number; by: string };
type Snap = { id: string; meals: number; days: number; opening: number; paidIn: number; foodCost: number; billShare: number; payouts: number; adjustments: number; balance: number };
const snapshot = (db: Db, flatId: string, month: string) => db<Snap>(
  `select member_id as id, weighted_meals as meals, days_present as days, opening::float8, paid_in::float8 as "paidIn", food_cost::float8 as "foodCost",
     bill_share::float8 as "billShare", payouts::float8, adjustments::float8, balance::float8
   from month_balances where flat_id = $1 and month = $2`, [flatId, month]);
export type Room = { id: string; name: string; rentShare: number };
export type Removed = { id: string; at: string; by: string; byId: string; type: LedgerRow['type']; amount: number; date: string; note: string | null; rejected: boolean };

export const monthOf = (date: string) => `${date.slice(0, 8)}01`;

/** Makes sure the month exists, and every month between the flat's latest month and it: a month nobody opened the app in
 *  still gets its monthly bills and still has to be closed in order. A new month copies the monthly bills for the people
 *  living in it, paid from flat money and added by the collector (whoever happens to open the page first must not own, or be
 *  able to remove, the flat's rent). Safe to call again. One statement: the months, their bills, their people and their history
 *  rows are created together or not at all, so a failure leaves nothing and the next call tries again; two people opening a
 *  month at once can't both copy (one wins the month row). */
export async function openMonth(db: Db, flatId: string, month: string) {
  await db(
    `with m as (insert into months (flat_id, month)
       select $1, g::date from generate_series(least(coalesce((select max(month) from months where flat_id = $1), $2::date), $2::date), $2::date, interval '1 month') g
       on conflict do nothing returning month),
     c as (select id from members where flat_id = $1 and role = 'manager'),
     t as (select gen_random_uuid() as lid, m.month, b.name, b.amount_poisha, b.split,
             array(select x from unnest(b.selected_member_ids) x where x in (select id from members where flat_id = $1
               and joined_on <= (m.month + interval '1 month' - interval '1 day')::date and (left_on is null or left_on >= m.month))) as sel   -- people who left are dropped
           from bill_templates b, m where b.flat_id = $1),
     ok as (select * from t where split <> 'selected' or cardinality(sel) > 0),
     l as (insert into ledger (id, flat_id, month, type, amount_poisha, split, date, note, status, created_by)
           select lid, $1, month, 'bill', amount_poisha, split, month, name, 'ok', (select id from c) from ok returning *),
     s as (insert into bill_split_members (flat_id, ledger_id, member_id) select $1, ok.lid, unnest(ok.sel) from ok where ok.split = 'selected')
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text, to_jsonb(l), l.created_by from l`,
    [flatId, month]);
}

/** A form's key becomes the entry's id, so two taps save once. An id any flat's ledger had and has no more (removed) is
 *  refused: its check and receipt stay with the id for Put back, and a new entry under it, here or in another flat, would take them. */
export async function retiredId(db: Db, id: string) {
  const [r] = await db<{ gone: boolean }>(`select exists (select 1 from audit_log where entity = 'ledger' and entity_id = $1)
    and not exists (select 1 from ledger where id = $1::uuid) as gone`, [id]);
  return r.gone;
}

/** One ledger row, its split people, its item lines, its receipt, its history row and (if `repeat`) its monthly template, all
 *  in one statement, so a bill can never be saved without the repeat the person ticked, nor a bazar without its lines. Callers check the rules. */
async function insertEntry(db: Db, flatId: string, by: string,
  e: { id?: string; type: LedgerRow['type']; amount: number; date: string; note: string | null; paidBy: string | null; memberId: string | null; split: Split | null; selected: string[]; method?: Method | null; items?: Item[]; receipt?: Uint8Array | null; notJoined?: boolean },
  status: 'ok' | 'pending', repeat: { split: Split; selected: string[] } | null = null) {
  return (await db(
    `with l as (insert into ledger (id, flat_id, month, type, amount_poisha, paid_by_member_id, member_id, split, date, note, status, created_by, method, held_by)
       values (coalesce($15::uuid, gen_random_uuid()), $1, date_trunc('month', $2::date)::date, $3, $4, $5, $6, $7, $2, $8, $9, $10, $16, $19::uuid)
       on conflict (id) do nothing returning *),
     s as (insert into bill_split_members (flat_id, ledger_id, member_id) select $1, l.id, x::uuid from l, json_array_elements_text($11::text::json) x),
     i as (insert into bazar_items (flat_id, ledger_id, pos, name, amount_poisha)
       select $1, l.id, x.n - 1, x.v->>'name', (x.v->>'amount')::bigint from l, json_array_elements($17::text::json) with ordinality x(v, n)),
     r as (insert into receipts (flat_id, ledger_id, month, photo) select $1, l.id, l.month, $18::bytea from l where $18::bytea is not null),
     t as (insert into bill_templates (flat_id, name, amount_poisha, split, selected_member_ids)
       select $1, $8, $4, $12, array(select json_array_elements_text($13::text::json)::uuid) from l where $14::boolean returning *),
     th as (insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'bill_templates', t.id::text, to_jsonb(t), $10 from t)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text,
       to_jsonb(l) || case when json_array_length($17::text::json) > 0 then jsonb_build_object('items', $17::text::jsonb) else '{}'::jsonb end
         || case when $20::boolean then '{"atOnce":"notJoined"}'::jsonb else '{}'::jsonb end, $10
     from l returning 1`,
    [flatId, e.date, e.type, e.amount, e.paidBy, e.memberId, e.split, e.note, status, by, JSON.stringify(e.split === 'selected' ? e.selected : []),
     repeat?.split ?? 'equal', JSON.stringify(repeat?.selected ?? []), repeat !== null, e.id ?? null, e.method ?? null,
     JSON.stringify(e.items ?? []), e.receipt ? Buffer.from(e.receipt) : null,
     // Money received is held by the collector who wrote it: the 011 trigger would give a waiting deposit whoever collects at
     // insert time, wrong if a handover lands between this person's role check and the save. null: the trigger decides.
     e.type === 'deposit' && e.memberId !== by ? by : null, e.notJoined ?? false])).length > 0;   // false: this id was saved already
}

/** Everything the money screens need for one month. The version is read first: closeMonth freezes only results computed
 *  from inputs no newer than it. A closed month comes from its snapshot, never recalculated. An open month starts from the
 *  latest closed month's snapshot, unless an earlier month is still open (then nothing is carried: the banner says so). */
export async function loadMonth(db: Db, flatId: string, month: string, today: string) {
  if (month === monthOf(today)) await openMonth(db, flatId, month);
  const [info = null] = await db<{ status: 'open' | 'closed'; version: number; closedAt: string | null; cash: CashRecord | null; fund: number | null; rate: number | null }>(
    `select status, version, closed_at::text as "closedAt", cash, closing_fund::float8 as fund, meal_rate::int as rate
     from months where flat_id = $1 and month = $2`, [flatId, month]);
  const earlier = await db<{ month: string; status: string; fund: number | null }>(
    `select month::text as month, status, closing_fund::float8 as fund from months where flat_id = $1 and month < $2 order by month`, [flatId, month]);
  const earlierOpen = earlier.find(x => x.status === 'open')?.month ?? null;
  const lastClosed = earlierOpen ? null : earlier.filter(x => x.status === 'closed').at(-1) ?? null;
  const closedMonths = [...earlier, ...(info?.status === 'closed' ? [{ month, status: 'closed', fund: null }] : [])]
    .filter(x => x.status === 'closed').map(x => x.month).reverse();

  const end = daysOfMonth(month).at(-1)!, upTo = today < end ? today : end;
  const { flat, members: everyone, changes } = await loadMeals(db, flatId, month, end);   // meals must come through loadMeals (no cooking)
  const roomOf = new Map((await db<{ id: string; roomId: string | null }>(
    `select id, room_id as "roomId" from members where flat_id = $1`, [flatId])).map(m => [m.id, m.roomId]));
  const all = everyone.map(m => ({ ...m, roomId: roomOf.get(m.id) ?? null }));
  const members = all.filter(m => m.joinedOn <= end && (m.leftOn === null || m.leftOn >= month));
  const rooms = await db<Room>(`select id, name, rent_share_poisha::int as "rentShare" from rooms where flat_id = $1 order by name`, [flatId]);
  const select = `select l.id, l.type, l.amount_poisha::int as amount, l.paid_by_member_id as "paidBy", l.member_id as "memberId", l.split, l.status,
       l.date::text as date, l.note, l.created_by as "createdBy", l.for_month::text as "forMonth", l.moves, l.held_by as "heldBy", l.method,
       (select c.state from entry_checks c where c.ledger_id = l.id) as "check",
       (select extract(epoch from r.created_at)::bigint::text from receipts r where r.flat_id = l.flat_id and r.ledger_id = l.id) as "receiptV",
       exists (select 1 from audit_log a where a.flat_id = l.flat_id and a.entity_id = l.id::text and a.entity = 'ledger'
         and a.after->>'atOnce' = 'notJoined') as "notJoined",
       (select coalesce(json_agg(s.member_id), '[]'::json) from bill_split_members s where s.ledger_id = l.id) as selected
     from ledger l`;
  const entries = await db<Entry>(`${select} where l.flat_id = $1 and l.month = $2 order by l.date desc, l.created_at desc`, [flatId, month]);
  const corrections = await db<Entry>(`${select} where l.flat_id = $1 and l.for_month = $2 order by l.date desc, l.created_at desc`, [flatId, month]);
  // per entry only its latest removal (audit ids follow commit order per entry: see putBack), and only while it is still gone;
  // `rejected`: removed by That's not right (rejectEntry), not by Remove
  const removed = await db<Removed>(
    `select id, at, by, "byId", type, amount, date, note, rejected from (select distinct on (a.entity_id) a.entity_id as id, a.at, m.name as by, a.by_member as "byId",
         a.before->>'type' as type, (a.before->>'amount_poisha')::int as amount, a.before->>'date' as date, a.before->>'note' as note, a.id as seq,
         coalesce(a.after->>'rejected' = 'true', false) as rejected
       from audit_log a join members m on m.flat_id = a.flat_id and m.id = a.by_member
       where a.flat_id = $1 and a.entity = 'ledger' and a.after->>'removed' = 'true' and a.before->>'month' = $2
         and not exists (select 1 from ledger l where l.flat_id = a.flat_id and l.id = a.entity_id::uuid)
       order by a.entity_id, a.id desc) r order by seq desc`, [flatId, month]);
  const first = monthOf(all.reduce((a, m) => (m.joinedOn < a ? m.joinedOn : a), month));
  const days = daysPresent(members, month);

  if (info?.status === 'closed') {
    const snap = await snapshot(db, flatId, month);
    const result: MonthResult = {
      mealRate: info.rate ?? 0, fund: info.fund ?? 0, invariantOk: true, problems: [], lines: [],
      perMember: snap.map(s => ({ id: s.id, opening: s.opening, paidIn: s.paidIn, foodCost: s.foodCost, billShare: s.billShare, payouts: s.payouts, adjustments: s.adjustments, balance: s.balance })),
    };
    return { flat, all, members, rooms, entries, removed, changes, meals: new Map(snap.map(s => [s.id, s.meals])), guestMeals: new Map<string, number>(),
      result, first, info, earlierOpen, carriedFrom: null, closedMonths, days: new Map(snap.map(s => [s.id, s.days])), corrections };
  }

  // corrections for a closed month carry that month's frozen split
  const frozen = new Map<string, Snap[]>();
  for (const fm of new Set(entries.map(x => x.forMonth).filter((x): x is string => !!x))) frozen.set(fm, await snapshot(db, flatId, fm));
  for (const x of entries) {
    if (!x.forMonth || (x.type !== 'bazar' && x.type !== 'bill')) continue;
    const s = frozen.get(x.forMonth) ?? [], byMeals = x.type === 'bazar' || x.split === 'meals';
    x.weights = x.split === 'selected' ? x.selected.map((id): [string, number] => [id, 1])
      : s.map((p): [string, number] => [p.id, byMeals ? p.meals : p.days]).filter(w => w[1] > 0);
  }
  const carried = lastClosed ? await snapshot(db, flatId, lastClosed.month) : [];
  const ids = new Set(members.map(m => m.id));
  for (const c of carried) if (c.balance !== 0) ids.add(c.id);   // someone who moved out keeps a row until settled
  // everyone an entry names: a correction's people, or money to someone who moved out while an earlier month is still open
  for (const x of entries) for (const id of [x.paidBy, x.memberId, x.moves, ...(x.weights ?? []).map(w => w[0])]) if (id) ids.add(id);

  const meals = weightedMeals(members, changes, month, flat.weights, upTo);
  const guestMeals = new Map(members.map(m => [m.id, changes
    .filter(c => c.memberId === m.id && c.date <= upTo && isPresent(m, c.date))
    .reduce((s, c) => s + c.guests * flat.weights[c.meal], 0)]));
  const result = monthBalances({
    memberIds: [...ids], opening: new Map(carried.map(c => [c.id, c.balance])), openingFund: lastClosed?.fund ?? 0,
    weightedMeals: meals, daysPresent: days, roomOf, rooms, ledger: entries,
  });
  return { flat, all, members, rooms, entries, removed, changes, meals, guestMeals, result, first, info, earlierOpen,
    carriedFrom: lastClosed?.month ?? null, closedMonths, days, corrections };
}

/** SQL over a ledger row `l`: who answers it while it waits (Yes or That's not right). A deposit someone wrote for themselves
 *  (I paid): the collector. Anything else (Money received or Give money, written by the collector): the person it is for.
 *  confirmEntry, rejectEntry, toConfirm and confirmerOf all use this, so they never disagree. Callers also require
 *  `l.created_by <> <me>`: nobody answers their own entry. */
export const CONFIRMER = `case when l.type = 'deposit' and l.created_by = l.member_id
  then (select c.id from members c where c.flat_id = l.flat_id and c.role = 'manager') else l.member_id end`;

/** Rows waiting for this person's answer. `name` = who wrote it; `forMe` = a deposit written for me (Yes, I gave it). */
export const toConfirm = (db: Db, flatId: string, memberId: string) => db<{
  id: string; type: 'deposit' | 'payout'; amount: number; date: string; note: string | null; method: Method | null; name: string; paidTo: string | null; forMe: boolean;
}>(
  // paidTo: who held this money (received a deposit, or paid out a payout), named only when that is no longer the
  // collector (after a handover) — so a waiting entry is never relabelled to whoever collects today
  `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.note, l.method, m.name,
       (l.type = 'deposit' and l.member_id = $2) as "forMe"
     , (select hb.name from members hb where hb.id = l.held_by
         and hb.id is distinct from (select id from members where flat_id = l.flat_id and role = 'manager')) as "paidTo"
   from ledger l join members m on m.flat_id = l.flat_id and m.id = l.created_by
   where l.flat_id = $1 and l.status = 'pending' and ${CONFIRMER} = $2 and l.created_by <> $2
   order by l.date, l.created_at`, [flatId, memberId]);

/** Who answers a waiting entry, for the push after it is saved: their id, language and what they are asked. Null when
 *  nothing waits (it counted at once: the collector's own deposit, someone who moved out). */
export async function confirmerOf(db: Db, flatId: string, id: string) {
  const [r] = await db<{ id: string; lang: 'en' | 'bn' | null; kind: 'deposit' | 'gave' | 'payout' }>(
    `select c.id, c.language as lang,
       case when l.type = 'payout' then 'payout' when l.created_by = l.member_id then 'deposit' else 'gave' end as kind
     from ledger l join members c on c.flat_id = l.flat_id and c.id = ${CONFIRMER}
     where l.flat_id = $1 and l.id = $2 and l.status = 'pending' and l.created_by <> c.id`, [flatId, id]);
  return r ?? null;
}

export type Actor = { memberId: string; role: 'member' | 'manager' };
export type NewEntry = {
  type: LedgerRow['type']; amount: number; date: string; note: string | null;
  paidBy: string | null;          // bazar, bill: who paid the shop; null = flat money
  memberId: string | null;        // deposit: who paid in; payout: who got it
  split: Split | 'here' | null;   // bills only; 'here' = everyone living here on the bill date
  selected: string[];
  repeat?: boolean;               // bills, collector only: also copy it into every new month (from flat money)
  id?: string;                    // one-time id from the form: a retry with the same id records nothing new
  method?: Method | null;         // deposit, payout: cash, bKash, Nagad or bank; null = not said
  items?: Item[];                 // bazar only: what was bought (020)
  receipt?: Uint8Array | null;    // bazar, bill: the receipt photo, a small JPEG (020)
};

/** The first date an entry may have. Flatmates: this month. The collector: the oldest month still open, so a bazar found after
 *  the 1st can be added with its real date before last month closes (closed months refuse writes in the database anyway). */
export async function entryFrom(db: Db, flatId: string, by: Actor, today: string) {
  if (by.role !== 'manager') return monthOf(today);
  const [r] = await db<{ m: string | null }>(`select min(month)::text as m from months where flat_id = $1 and status = 'open'`, [flatId]);
  return r.m && r.m < monthOf(today) ? r.m : monthOf(today);
}

/** Adds an entry if the rules allow it. 'rooms' = rent by room asked before rooms and rents are set. With `today` (every form
 *  does), the date must lie from entryFrom to today ('date'), and only an entry in this month may repeat monthly. */
/** 'again': the same entry (same id) was saved before, so nothing new went in: the form's retry, not an error. */
export async function addEntry(db: Db, flatId: string, by: Actor, e: NewEntry, today?: string): Promise<'ok' | 'again' | 'bad' | 'rooms' | 'gone' | 'date' | 'items' | 'receipt'> {
  const boss = by.role === 'manager', moving = e.type === 'deposit' || e.type === 'payout';
  if (today !== undefined) {
    if (e.date > today || e.date < await entryFrom(db, flatId, by, today)) return 'date';
    if (e.repeat && monthOf(e.date) !== monthOf(today)) return 'bad';   // a forgotten bill from last month never starts a monthly one
  }
  if (!Number.isInteger(e.amount) || e.amount <= 0) return 'bad';
  // 020: item lines only on a bazar and never over its total; a receipt only on a bazar or bill, a small JPEG
  const items = e.items ?? [];
  if (items.length && e.type !== 'bazar') return 'bad';
  if (!itemsOk(items, e.amount)) return 'items';
  if (e.receipt && ((e.type !== 'bazar' && e.type !== 'bill') || !isJpeg(e.receipt, MAX_RECEIPT))) return 'receipt';
  if ((e.type === 'bill') !== (e.split !== null)) return 'bad';
  if (moving ? !e.memberId || e.paidBy : e.memberId || e.method) return 'bad';
  if (e.type === 'payout' && !boss) return 'bad';                                  // only the collector hands out flat money
  if (e.type === 'deposit' && !boss && e.memberId !== by.memberId) return 'bad';   // members deposit only for themselves
  if (e.repeat && (!boss || e.type !== 'bill')) return 'bad';                      // monthly bills are the collector's
  const month = monthOf(e.date), end = daysOfMonth(month).at(-1)!;
  const here = await db<{ id: string; joinedOn: string; leftOn: string | null; roomId: string | null; gone: boolean; notJoined: boolean }>(
    `select id, joined_on::text as "joinedOn", left_on::text as "leftOn", room_id as "roomId",
       left_on < (now() at time zone 'Asia/Dhaka')::date as gone, pin_hash is null as "notJoined" from members
     where flat_id = $1 and joined_on <= $3 and (left_on is null or left_on >= $2)`, [flatId, month, end]);
  let split = e.split, selected = e.split === 'selected' ? e.selected : [];
  if (split === 'here') {
    split = 'selected';
    selected = here.filter(m => m.joinedOn <= e.date && (m.leftOn === null || m.leftOn >= e.date)).map(m => m.id);
  }
  if (split === 'selected' && !selected.length) return 'bad';
  // someone who moved out before this month but still has a balance from the latest closed month, or who lived in a closed
  // month this month corrects, can be settled with (deposits and payouts only)
  const owed = moving ? await db<{ id: string }>(
    `select member_id as id from month_balances where flat_id = $1 and balance <> 0
       and month = (select max(month) from months where flat_id = $1 and month < $2::date and status = 'closed')
     union select member_id from month_balances where flat_id = $1
       and month in (select for_month from ledger where flat_id = $1 and month = $2::date and for_month is not null)`, [flatId, month]) : [];
  const ids = new Set([...here.map(m => m.id), ...owed.map(o => o.id)]);
  // the collector may record their own deposit into any open month, so they can cover the gap of a month before their time
  if (boss && e.type === 'deposit' && e.memberId === by.memberId) ids.add(by.memberId);
  if (![e.paidBy, e.memberId, ...selected].every(id => id === null || ids.has(id))) return 'bad';
  // whoever paid the shop or the bill was living here that day; money to or from someone who left is settling up, so it stays allowed
  if (e.paidBy && !here.some(m => m.id === e.paidBy && m.joinedOn <= e.date && (m.leftOn === null || m.leftOn >= e.date))) return 'gone';
  if (split === 'room') {
    const rooms = await db<{ id: string }>(`select id from rooms where flat_id = $1 and rent_share_poisha > 0`, [flatId]);
    if (!rooms.length || here.some(m => !m.roomId) || rooms.some(r => !here.some(m => m.roomId === r.id))) return 'rooms';
  }
  // money between two people waits for whoever didn't write it (CONFIRMER): the collector for a flatmate's own deposit, the
  // person for money the collector wrote as received from or given to them. Someone who has moved out can't sign in to
  // answer, so then it counts at once: the collector's entry is the record. The collector's own deposit always counts at once.
  // So does money with someone who hasn't joined yet (can't sign in either): marked notJoined, so it stays visible after they join.
  const gone = here.some(m => m.id === e.memberId && m.gone) || (owed.some(o => o.id === e.memberId) && !here.some(m => m.id === e.memberId));
  const waits = (e.type === 'deposit' && !boss) || (moving && e.memberId !== by.memberId && !gone);
  const notJoined = waits && e.memberId !== by.memberId && here.some(m => m.id === e.memberId && m.notJoined);   // they would answer
  const pending = waits && !notJoined;
  if (e.id && await retiredId(db, e.id)) return 'bad';
  await openMonth(db, flatId, month);
  // a repeated "everyone living here" bill becomes "everyone, by days": the people living here change month to month
  const repeat = e.repeat ? (split === 'selected' && e.split !== 'here' ? { split: 'selected' as const, selected } : { split: e.split === 'here' ? 'equal' as const : split!, selected: [] }) : null;
  return await insertEntry(db, flatId, by.memberId, { ...e, split, selected, notJoined }, pending ? 'pending' : 'ok', repeat) ? 'ok' : 'again';
}

/** Yes: by whoever answers it (CONFIRMER), only while it waits; never the writer. */
export async function confirmEntry(db: Db, flatId: string, by: Actor, id: string) {
  const r = await db(
    `with x as (update ledger l set status = 'ok' where l.flat_id = $1 and l.id = $2 and l.status = 'pending'
       and ${CONFIRMER} = $3 and l.created_by <> $3 returning l.id)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', x.id::text, '{"status":"ok"}', $3 from x returning 1`,
    [flatId, id, by.memberId]);
  return r.length > 0;
}

/** That's not right: whoever answers it (CONFIRMER) removes a waiting entry, one statement. It stays in the history the way
 *  removeEntry keeps a removal, marked rejected (put back brings it back, still waiting). Returns who wrote it, for the push;
 *  null when nothing waited for this person (someone acted first, or it isn't theirs to answer). */
export async function rejectEntry(db: Db, flatId: string, by: Actor, id: string) {
  const [r] = await db<{ writer: string }>(
    `with d as (delete from ledger l where l.flat_id = $1 and l.id = $2 and l.status = 'pending'
       and ${CONFIRMER} = $3 and l.created_by <> $3 returning l.*),
     a as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select $1, 'ledger', d.id::text, to_jsonb(d), '{"removed":true,"rejected":true}', $3 from d)
     select created_by as writer from d`,
    [flatId, id, by.memberId]);
  return r?.writer ?? null;
}

/** Whoever added it, or the collector, removes an entry. A confirmed deposit only the collector: the cash is with them.
 *  A non-collector: only this month's entries (`today` is the Dhaka date) — a past month is never changed for them.
 *  The collector: this month or any earlier month that is still open; once a month closes, removal is forbidden for anyone,
 *  enforced here (not just a hidden button) by requiring the entry's month to have a `months` row with status 'open'.
 *  A pending entry can go from any month: it counts nowhere, and a wrong one must not wait forever for a tap.
 *  The removed row is kept in the history, so the entries list can show it. */
export async function removeEntry(db: Db, flatId: string, by: Actor, id: string, today: string) {
  const r = await db(
    `with l as (delete from ledger where flat_id = $1 and id = $2
       and (
         status = 'pending'
         or ($4::boolean and exists (select 1 from months mo where mo.flat_id = $1 and mo.month = ledger.month and mo.status = 'open'))
         or (not $4::boolean and month = $5::date)
       )
       and ($4::boolean or (created_by = $3 and (type <> 'deposit' or status = 'pending'))) returning *)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'ledger', l.id::text,
       -- the picked people and item lines are deleted with the entry, so they are kept in the record too
       to_jsonb(l) || jsonb_build_object('selected', (select coalesce(jsonb_agg(sm.member_id), '[]') from bill_split_members sm where sm.ledger_id = l.id),
         'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'amount', i.amount_poisha) order by i.pos), '[]') from bazar_items i where i.ledger_id = l.id)),
       '{"removed":true}', $3 from l returning 1`,
    [flatId, id, by.memberId, by.role === 'manager', monthOf(today)]);
  return r.length > 0;
}

/** Rooms and rent shares (collector only). Every change goes to the history: rent moves everyone's balance.
 *  `guard` (every form passes it): rooms, rent shares and meal weights are read as they are today by every open month. So while
 *  a month that has ended is still open, a change that can move its bill is refused with 'earlier' unless `fix` says it
 *  deliberately corrects it; the history row then lists the months it corrected (`fixFor`). It asks even when that month has
 *  no rent bill yet: one can still be added or put back later. In the same statement the ended months are locked too, so a
 *  close running now finishes first and its month drops out: nothing is refused for, or claims to fix, a month already closed.
 *  The ask and the "did it change" check are made on the updated row, which Postgres checks again against the newest version
 *  after waiting, so a change saved at the same moment from another tab is asked or applied, never skipped. */
export type Guard = { today: string; fix: boolean };
/** The oldest month that has ended (before today's month) and is still open, or null. */
export async function endedOpenMonth(db: Db, flatId: string, today: string) {
  const [r] = await db<{ m: string | null }>(`select min(month)::text as m from months where flat_id = $1 and status = 'open' and month < $2::date`, [flatId, monthOf(today)]);
  return r.m;
}
/** SQL CTE `ended`: months that have ended (before the month of `t`) and are still open, locked with no key update in month
 *  order, the order the month triggers lock them in (migration 014). */
const ended = (t: string) => `ended as (select month from months where flat_id = $1 and status = 'open'
    and month < date_trunc('month', ${t}::text::date) order by month for no key update)`;
/** SQL comment on the gate: `(select ask from g) is not null` is always true and names no row, so Postgres works out `g` once,
 *  before reading the row. For an unticked save that locks the oldest ended month before the row (as before Plan 7); the other
 *  open months lock after it, through fixNote and the month triggers. Writers don't share one lock order (the trigger writers
 *  lock the row first), so a rare deadlock is possible; lib/db.ts runs the statement once more. */
const GATE = '-- (select ask from g) is not null: see GATE.';
/** SQL: the history note for a ticked fix, naming every month it corrected (`m`: a set of months), or nothing. */
const fixNote = (f: string, m: string) => `case when ${f}::boolean and exists (select 1 from ${m}) then jsonb_build_object('fixFor',
    (select jsonb_agg(month::text order by month) from ${m})) else '{}'::jsonb end`;

export async function addRoom(db: Db, flatId: string, by: Actor, name: string, rent: number, guard?: Guard): Promise<string | null | 'earlier'> {
  if (by.role !== 'manager' || !name.trim() || name.length > 40 || !Number.isInteger(rent) || rent < 0) return null;
  // a room with a rent share and nobody in it leaves that month's rent with an empty room; a ৳0 room changes nothing
  const [r] = await db<{ id: string | null; blocked: boolean }>(
    `with ${ended('$5')},
     g as (select $5::text is not null and not $6::boolean and $3 > 0 and exists (select 1 from ended) as blocked),
     r as (insert into rooms (flat_id, name, rent_share_poisha) select $1, $2, $3 where not (select blocked from g) returning *),
     a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
       select $1, 'rooms', r.id::text, to_jsonb(r) || case when $3 > 0 then ${fixNote('$6', 'ended')} else '{}'::jsonb end, $4 from r)
     select (select id from r) as id, (select blocked from g) as blocked`,
    [flatId, name, rent, by.memberId, guard?.today ?? null, guard?.fix ?? false]);
  return r.blocked ? 'earlier' : r.id;
}

export async function setRent(db: Db, flatId: string, by: Actor, roomId: string, rent: number, guard?: Guard): Promise<boolean | 'earlier'> {
  if (by.role !== 'manager' || !Number.isInteger(rent) || rent < 0) return false;
  const [r] = await db<{ n: number; blocked: boolean }>(
    `with ${ended('$5')},
     g as (select $5::text is not null and not $6::boolean and exists (select 1 from ended) as ask),
     -- The old rent comes from the row this update locks (the newest committed one), never from the form. Whether the rent
     -- differs is checked on the updated row itself, which Postgres checks again against the newest version after waiting:
     -- this statement's own snapshot may predate a change saved at the same moment. ${GATE}
     r as (update rooms x set rent_share_poisha = $3
       from (select id, rent_share_poisha from rooms where flat_id = $1 and id = $2 for no key update) o
       where x.id = o.id and (select ask from g) is not null and not ((select ask from g) and x.rent_share_poisha <> $3)
       returning x.*, o.rent_share_poisha as was),
     a as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member) select $1, 'rooms', r.id::text,
       jsonb_build_object('rent_share_poisha', r.was), to_jsonb(r) - 'was' || ${fixNote('$6', 'ended')}, $4 from r where r.was <> $3)
     select (select count(*) from r where was <> $3)::int as n,
       (select ask from g) and not exists (select 1 from r) and exists (select 1 from rooms where flat_id = $1 and id = $2) as blocked`,
    [flatId, roomId, rent, by.memberId, guard?.today ?? null, guard?.fix ?? false]);
  return r.blocked ? 'earlier' : r.n > 0;   // false: no such room in this flat, or the same rent again (no history line)
}

export async function setRoom(db: Db, flatId: string, by: Actor, memberId: string, roomId: string | null, guard?: Guard): Promise<boolean | 'earlier'> {
  if (by.role !== 'manager') return false;
  // only the months this person lived in move; an October newcomer's room changes no ended month
  const [r] = await db<{ n: number; blocked: boolean }>(
    `with ${ended('$5')},
     hit as (select e.month from ended e, members p where p.flat_id = $1 and p.id = $2
       and p.joined_on <= (e.month + interval '1 month' - interval '1 day')::date and (p.left_on is null or p.left_on >= e.month)),
     g as (select $5::text is not null and not $6::boolean and exists (select 1 from hit) as ask),
     -- the old room comes from the row this update locks, never from the form; names are saved too (rooms are never renamed).
     -- Whether the room differs is checked on the updated row itself, as in setRent. ${GATE}
     m as (update members p set room_id = $3
       from (select id, room_id from members where flat_id = $1 and id = $2 for no key update) o
       where p.id = o.id and (select ask from g) is not null and not ((select ask from g) and p.room_id is distinct from $3::uuid)
       and ($3::uuid is null or exists (select 1 from rooms where flat_id = $1 and id = $3)) returning p.id, p.room_id, o.room_id as was),
     a as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select $1, 'rooms', m.id::text, jsonb_build_object('roomId', m.was, 'room', (select name from rooms where id = m.was)),
         jsonb_build_object('roomId', m.room_id, 'room', (select name from rooms where id = m.room_id)) || ${fixNote('$6', 'hit')}, $4
       from m where m.was is distinct from m.room_id)
     select (select count(*) from m where was is distinct from room_id)::int as n,
       (select ask from g) and not exists (select 1 from m) and exists (select 1 from members where flat_id = $1 and id = $2)
         and ($3::uuid is null or exists (select 1 from rooms where flat_id = $1 and id = $3)) as blocked`,
    [flatId, memberId, roomId, by.memberId, guard?.today ?? null, guard?.fix ?? false]);
  return r.blocked ? 'earlier' : r.n > 0;   // false: no such member or room in this flat, or the same room again (no history line)
}

export const listRepeats = (db: Db, flatId: string) => db<{ id: string; name: string; amount: number; split: Split }>(
  `select id, name, amount_poisha::int as amount, split from bill_templates where flat_id = $1 order by name`, [flatId]);

export async function stopRepeat(db: Db, flatId: string, by: Actor, id: string) {
  if (by.role !== 'manager') return false;
  const done = await db(
    `with t as (delete from bill_templates where flat_id = $1 and id = $2 returning *)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'bill_templates', t.id::text, to_jsonb(t), '{"removed":true}', $3 from t returning 1`, [flatId, id, by.memberId]);
  return done.length > 0;   // false: no such monthly bill in this flat
}

/** Every ledger column: a removal record missing any of them is never put back. A test keeps this in step with the table. */
export const LEDGER_COLUMNS = 'id,flat_id,month,type,amount_poisha,paid_by_member_id,member_id,split,date,note,trxid,status,version,created_by,created_at,for_month,moves,held_by,method';
/** What a removal record must hold to be put back: every column a row had before migration 009 added the two correction ones,
 *  011 added held_by (an older record puts back with held_by null, so the insert trigger fills the current collector) and 019
 *  added method (an older record puts back with none). */
const PUT_BACK_COLUMNS = LEDGER_COLUMNS.replace(',for_month,moves,held_by,method', '');

/** Brings a removed entry back exactly as it was (same id, status, people), rebuilt only from its latest removal record.
 *  Whoever made that removal: only while it's still this month (`today` is the Dhaka date). The current collector: this
 *  month or any earlier month that is still open — same window as removeEntry. Either way the entry's month must still
 *  have a `months` row with status 'open'.
 *  One statement: the entry, its people and the history row land together; a second tap finds the entry back and writes nothing.
 *  Per entry, remove (delete … returning) and put back (insert … on conflict do nothing) can only succeed one after the other,
 *  each after the previous committed, so the highest audit id is the latest removal. */
export async function putBack(db: Db, flatId: string, by: string, id: string, today: string) {
  const r = await db(
    `with a as (select before, by_member from audit_log where flat_id = $1 and entity = 'ledger' and entity_id = $2 and after->>'removed' = 'true'
       order by id desc limit 1),
     ok as (select a.before from a
       where a.before ?& string_to_array($5::text, ',')
         and (a.before->>'flat_id')::uuid = $1
         and exists (select 1 from months where flat_id = $1 and month = (a.before->>'month')::date and status = 'open')
         and (
           (a.by_member = $3 and (a.before->>'month')::date = $4::date)
           or exists (select 1 from members where flat_id = $1 and id = $3 and role = 'manager')
         )),
     l as (insert into ledger select (jsonb_populate_record(null::ledger, ok.before)).* from ok on conflict do nothing returning *),
     s as (insert into bill_split_members (flat_id, ledger_id, member_id)
       select $1, l.id, x::uuid from l, ok, jsonb_array_elements_text(coalesce(ok.before->'selected', '[]'::jsonb)) x),
     i as (insert into bazar_items (flat_id, ledger_id, pos, name, amount_poisha)
       select $1, l.id, x.n - 1, x.v->>'name', (x.v->>'amount')::bigint
       from l, ok, jsonb_array_elements(coalesce(ok.before->'items', '[]'::jsonb)) with ordinality x(v, n))
     insert into audit_log (flat_id, entity, entity_id, after, by_member)
     select $1, 'ledger', l.id::text, to_jsonb(l) || '{"putBack":true}', $3 from l returning 1`,
    [flatId, id, by, monthOf(today), PUT_BACK_COLUMNS]);
  return r.length > 0;
}
