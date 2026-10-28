import { cleanName, cleanText } from './auth';
import type { Db } from './db';
import { toPoisha } from './money';
import type { Actor } from './money-db';
import { isJpeg, MAX_RECEIPT } from './photo';

/** One line of what a bazar bought: a name and, if written, what it cost (poisha). */
export type Item = { name: string; amount: number | null };
export const MAX_ITEMS = 30;

/** The form's item lines (names and amounts in the same order). An empty line is skipped; a line with an amount but no name,
 *  a name over 40 characters, an amount that isn't taka, or more than 30 lines: null. */
export function parseItems(names: string[], amounts: string[]): Item[] | null {
  const out: Item[] = [];
  for (let i = 0; i < Math.max(names.length, amounts.length); i++) {
    const text = cleanText(names[i]), raw = (amounts[i] ?? '').trim();
    if (!text && !raw) continue;
    const name = cleanName(text), amount = raw ? toPoisha(raw) : null;
    if (!name || (raw && amount === null)) return null;
    out.push({ name, amount });
  }
  return out.length <= MAX_ITEMS ? out : null;
}

/** Item amounts may add up to less than the total (the rest is Other items), never more. */
export const itemsOk = (items: Item[], total: number) => items.length <= MAX_ITEMS
  && items.every(i => cleanName(i.name) === i.name && (i.amount === null || (Number.isInteger(i.amount) && i.amount > 0)))
  && items.reduce((a, i) => a + (i.amount ?? 0), 0) <= total;

/** What the item lines leave of the total, shown as Other items: only when some line has an amount. */
export const otherItems = (items: Item[], total: number) =>
  items.some(i => i.amount !== null) ? total - items.reduce((a, i) => a + (i.amount ?? 0), 0) : 0;

/** The flat summary's money lines for a month's own entries (a correction for a closed month stays out, as in Total bazar).
 *  Paid in = confirmed deposits; Total spent = bazar plus bills, whoever paid (a bazar bought with cash from Give money has
 *  a payer, so a flat-money-only total would leave out the flow the collector uses most). */
export function monthTotals(entries: { type: string; status: string; amount: number; forMonth: string | null }[]) {
  const sum = (t: string) => entries.filter(e => e.type === t && e.status === 'ok' && !e.forMonth).reduce((a, e) => a + e.amount, 0);
  const bazar = sum('bazar'), bills = sum('bill');
  return { bazar, bills, spent: bazar + bills, paidIn: sum('deposit') };
}

/** Every item line of a month's bazars, by entry id, in their order. */
export const itemsFor = async (db: Db, flatId: string, month: string) => new Map((await db<{ id: string; items: Item[] }>(
  `select i.ledger_id as id, json_agg(json_build_object('name', i.name, 'amount', i.amount_poisha::int) order by i.pos) as items
   from bazar_items i join ledger l on l.flat_id = i.flat_id and l.id = i.ledger_id
   where i.flat_id = $1 and l.month = $2::text::date group by i.ledger_id`, [flatId, month])).map(r => [r.id, r.items]));

/** A receipt photo, only for someone in the same flat. */
export async function receiptOf(db: Db, flatId: string, ledgerId: string) {
  const [r] = await db<{ photo: Uint8Array }>(`select photo from receipts where flat_id = $1 and ledger_id = $2`, [flatId, ledgerId]);
  return r?.photo ?? null;
}

/** Verified ('ok') or Needs correction ('fix', with a reason) on a waiting bazar or bill, by someone may_check allows today.
 *  One statement. It locks the entry's month row (no key update, as month_touch does) without bumping its version and needs
 *  the month open: a close running now finishes first and this then finds the month closed and writes nothing; a handover
 *  offer and a close card stay valid. `not exists` reads before the insert, so a check tapped while a Fix it is saving never
 *  waits on that entry's row (no deadlock with the fix's month lock) and writes nothing. A second tap, or two checkers at
 *  once: the row is there, nothing is written. Returns the entry for the push, or null. */
export async function checkEntry(db: Db, flatId: string, by: Actor, id: string, state: 'ok' | 'fix', note: string | null, today: string) {
  const reason = state === 'fix' ? cleanText(note) || null : null;
  if (state === 'fix' && (!reason || reason.length > 100)) return null;
  const [r] = await db<{ adder: string; type: 'bazar' | 'bill'; amount: number }>(
    `with m as (select mo.month from months mo join ledger l on l.flat_id = mo.flat_id and l.month = mo.month
         where l.flat_id = $1 and l.id = $2 and l.type in ('bazar', 'bill') and l.status = 'ok' and mo.status = 'open'
         for no key update of mo),
       c as (insert into entry_checks (flat_id, ledger_id, month, state, note, by_member)
         select $1, $2, m.month, $4, $5, $3 from m
         where not exists (select 1 from entry_checks where ledger_id = $2) and may_check($2, $3, $6::text::date)
         on conflict (ledger_id) do nothing returning *),
       a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
         select $1, 'ledger', c.ledger_id::text, jsonb_build_object('checked', c.state)
           || case when c.note is null then '{}'::jsonb else jsonb_build_object('note', c.note) end, $3 from c)
     select l.created_by as adder, l.type, l.amount_poisha::int as amount from c join ledger l on l.id = c.ledger_id`,
    [flatId, id, by.memberId, state, reason, today]);
  return r ?? null;
}

/** SQL: may `me` Fix it on ledger row `l` (its check `c`, its month row `mo`) today? Sent back, its month open, and the
 *  collector (any open month) or whoever added it in its own month: the rule fixEntry keeps. */
const mayFix = (me: string, today: string) => `(c.state = 'fix' and mo.status = 'open' and (exists (select 1 from members w
  where w.flat_id = l.flat_id and w.id = ${me} and w.role = 'manager') or (l.created_by = ${me}
  and l.month = date_trunc('month', ${today}::text::date)::date)))`;

/** Bazars and bills of open months for this person: waiting ones may_check lets them check (the collector: everyone else's;
 *  a flatmate: the collector's own, monthly bills included), and entries sent back that are theirs to fix, with the reason:
 *  their own, and for the collector also an earlier month's (its adder can't fix it any more). */
export const toCheck = (db: Db, flatId: string, memberId: string, today: string) => db<{
  id: string; type: 'bazar' | 'bill'; amount: number; date: string; note: string | null; state: 'fix' | null; reason: string | null;
}>(
  `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.note, c.state, c.note as reason
   from ledger l join months mo on mo.flat_id = l.flat_id and mo.month = l.month and mo.status = 'open'
   left join entry_checks c on c.ledger_id = l.id
   where l.flat_id = $1 and l.type in ('bazar', 'bill') and l.status = 'ok'
     and ((c.ledger_id is null and may_check(l.id, $2, $3::text::date)) or (${mayFix('$2', '$3')}
       and (l.created_by = $2 or l.month < date_trunc('month', $3::text::date)::date)))
   order by l.date, l.created_at`, [flatId, memberId, today]);

export type Detail = {
  id: string; type: 'bazar' | 'bill'; amount: number; date: string; month: string; note: string | null; paidBy: string | null;
  createdBy: string; addedBy: string; addedAt: string; open: boolean; check: 'ok' | 'fix' | null; reason: string | null;
  checkedBy: string | null; checkedAt: string | null; receiptV: string | null; mayCheck: boolean; mayFix: boolean; items: Item[];
};
/** One bazar or bill for its page: its lines, receipt and check, whether `me` may check it now (open month, no check yet, may_check) or fix it, and the flat's people
 *  (Fix it's Who paid). Null for anything not a bazar or bill of this flat. */
export async function entryDetail(db: Db, flatId: string, id: string, me: string, today: string) {
  const [d] = await db<Detail>(
    `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.month::text as month, l.note, l.paid_by_member_id as "paidBy",
       l.created_by as "createdBy", a.name as "addedBy", l.created_at::text as "addedAt", mo.status = 'open' as open,
       c.state as "check", c.note as reason, cb.name as "checkedBy", c.at::text as "checkedAt",
       extract(epoch from r.created_at)::bigint::text as "receiptV", mo.status = 'open' and c.ledger_id is null
         and coalesce(may_check(l.id, $3, $4::text::date), false) as "mayCheck",
       coalesce(${mayFix('$3', '$4')}, false) as "mayFix",
       (select coalesce(json_agg(json_build_object('name', i.name, 'amount', i.amount_poisha::int) order by i.pos), '[]'::json)
          from bazar_items i where i.ledger_id = l.id) as items
     from ledger l join members a on a.flat_id = l.flat_id and a.id = l.created_by
       join months mo on mo.flat_id = l.flat_id and mo.month = l.month
       left join entry_checks c on c.ledger_id = l.id
       left join members cb on cb.flat_id = c.flat_id and cb.id = c.by_member
       left join receipts r on r.flat_id = l.flat_id and r.ledger_id = l.id
     where l.flat_id = $1 and l.id = $2 and l.type in ('bazar', 'bill') and l.status = 'ok'`, [flatId, id, me, today]);
  if (!d) return null;
  const people = await db<{ id: string; name: string; joinedOn: string; leftOn: string | null; collector: boolean }>(
    `select id, name, joined_on::text as "joinedOn", left_on::text as "leftOn", role = 'manager' as collector
     from members where flat_id = $1 order by name`, [flatId]);
  return { d, people };
}

export type Fix = { id: string; amount: number; date: string; paidBy: string | null; note: string | null; items: Item[]; receipt: Uint8Array | null };

/** Fix it, on an entry sent back with Needs correction: whoever added it or the collector saves new values and it waits for a
 *  check again. Same id, so its items, receipt and history stay attached. The rules of adding: an amount, a date in the
 *  entry's own month up to today, a payer living here that day, items not over the total; a bill keeps its name and split.
 *  One statement: the check row goes only together with the update (`l` needs `c`), so two fixes at once land once. The
 *  ledger trigger moves the month's version as for any money change. The history row keeps before and after, item lines
 *  included, and is marked `fixed` (may_check reads who fixed it last). A flatmate fixes only an entry of this month (as
 *  entryFrom and removeEntry), the collector any open month. Throws month_closed (the closed-month trigger) if the month
 *  closed since it was sent back. Returns who sent it back, for the push. */
export async function fixEntry(db: Db, flatId: string, by: Actor, f: Fix, today: string):
  Promise<{ result: 'ok'; marker: string; type: 'bazar' | 'bill'; amount: number } | { result: 'bad' | 'date' | 'gone' | 'items' | 'receipt' }> {
  if (!Number.isInteger(f.amount) || f.amount <= 0) return { result: 'bad' };
  if (!itemsOk(f.items, f.amount)) return { result: 'items' };
  if (f.receipt && !isJpeg(f.receipt, MAX_RECEIPT)) return { result: 'receipt' };
  const [e] = await db<{ type: 'bazar' | 'bill'; month: string }>(
    `select type, month::text as month from ledger where flat_id = $1 and id = $2 and type in ('bazar', 'bill')`, [flatId, f.id]);
  if (!e || (e.type === 'bill' && (!f.note || f.items.length))) return { result: 'bad' };
  if (f.date > today || `${f.date.slice(0, 8)}01` !== e.month) return { result: 'date' };
  if (f.paidBy && !(await db(`select 1 from members where flat_id = $1 and id = $2 and joined_on <= $3::text::date
      and (left_on is null or left_on >= $3::text::date)`, [flatId, f.paidBy, f.date])).length) return { result: 'gone' };
  const [r] = await db<{ marker: string; type: 'bazar' | 'bill'; amount: number }>(
    `with o as (select * from ledger where flat_id = $1 and id = $2 for no key update),
       oi as (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'amount', amount_poisha) order by pos), '[]'::jsonb) as items
         from bazar_items where ledger_id = $2),
       ok as (select o.* from o where ($4::boolean or (o.created_by = $3 and o.month = date_trunc('month', $11::text::date)::date))
         and date_trunc('month', $6::text::date)::date = o.month),
       c as (delete from entry_checks where flat_id = $1 and ledger_id = $2 and state = 'fix' and exists (select 1 from ok) returning by_member),
       l as (update ledger x set amount_poisha = $5, date = $6::text::date, paid_by_member_id = $7, note = $8
         from ok where x.id = ok.id and exists (select 1 from c) returning x.*),
       d as (delete from bazar_items where ledger_id = $2 and pos >= json_array_length($9::text::json) and exists (select 1 from l)),
       i as (insert into bazar_items (flat_id, ledger_id, pos, name, amount_poisha)
         select $1, l.id, x.n - 1, x.v->>'name', (x.v->>'amount')::bigint from l, json_array_elements($9::text::json) with ordinality x(v, n)
         on conflict (ledger_id, pos) do update set name = excluded.name, amount_poisha = excluded.amount_poisha),
       r as (insert into receipts (flat_id, ledger_id, month, photo) select $1, l.id, l.month, $10::bytea from l where $10::bytea is not null
         on conflict (ledger_id) do update set photo = excluded.photo, created_at = now()),
       a as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
         select $1, 'ledger', l.id::text, to_jsonb(o) || jsonb_build_object('items', (select items from oi)),
           to_jsonb(l) || jsonb_build_object('items', $9::text::jsonb, 'fixed', true)
             || case when $10::bytea is null then '{}'::jsonb else '{"receipt":true}'::jsonb end, $3 from l, o)
     select c.by_member as marker, l.type, l.amount_poisha::int as amount from c, l`,
    [flatId, f.id, by.memberId, by.role === 'manager', f.amount, f.date, f.paidBy, f.note, JSON.stringify(f.items), f.receipt ? Buffer.from(f.receipt) : null, today]);
  return r ? { result: 'ok', ...r } : { result: 'bad' };
}

/** SQL (unaliased `ledger`): a row that keeps month `m` from closing. Money waiting for a tap, in this or a later open month
 *  (the caller limits to month >= m): it is in the hand but not in the books. Or a bazar or bill of month `m` itself that
 *  isn't Verified (waiting or Needs correction): a later month's are checked before that month closes. */
export const blocksClose = (m: string) => `(status = 'pending' or (month = ${m} and type in ('bazar', 'bill')
  and not exists (select 1 from entry_checks c where c.ledger_id = ledger.id and c.state = 'ok')))`;
