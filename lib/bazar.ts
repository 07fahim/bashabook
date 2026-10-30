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

/** SQL: the receipt photo's version of entry `id` as the entry page shows it (receiptV), '' for none. */
const photoV = (id: string) => `coalesce((select extract(epoch from r.created_at)::bigint::text from receipts r where r.ledger_id = ${id}), '')`;

/** The receipt version now ('' for none): tells a refused check that the photo changed meanwhile. */
export const receiptVersion = async (db: Db, flatId: string, id: string) =>
  (await db<{ v: string }>(`select ${photoV('$2')} as v from ledger where flat_id = $1 and id = $2`, [flatId, id]))[0]?.v ?? '';

/** Verified ('ok') or Needs correction ('fix', with a reason) on a waiting bazar or bill, by someone may_check allows today.
 *  `rv` is the receipt version the checker's page showed ('' for none): a photo added or changed since then refuses the
 *  tap, so Verified always means the final photo was seen.
 *  One statement. It locks the entry's month row (no key update, as month_touch does) without bumping its version and needs
 *  the month open: a close running now finishes first and this then finds the month closed and writes nothing; a handover
 *  offer and a close card stay valid. `not exists` reads before the insert, so a check tapped while a Fix it is saving never
 *  waits on that entry's row (no deadlock with the fix's month lock) and writes nothing. A second tap, or two checkers at
 *  once: the row is there, nothing is written. Returns the entry for the push, or null. */
export async function checkEntry(db: Db, flatId: string, by: Actor, id: string, state: 'ok' | 'fix', note: string | null, today: string, rv: string) {
  const reason = state === 'fix' ? cleanText(note) || null : null;
  if (state === 'fix' && (!reason || reason.length > 100)) return null;
  const [r] = await db<{ adder: string; type: 'bazar' | 'bill'; amount: number }>(
    `with m as (select mo.month from months mo join ledger l on l.flat_id = mo.flat_id and l.month = mo.month
         where l.flat_id = $1 and l.id = $2 and l.type in ('bazar', 'bill') and l.status = 'ok' and mo.status = 'open'
         for no key update of mo),
       c as (insert into entry_checks (flat_id, ledger_id, month, state, note, by_member)
         select $1, $2, m.month, $4, $5, $3 from m
         where not exists (select 1 from entry_checks where ledger_id = $2) and may_check($2, $3, $6::text::date) and ${photoV('$2')} = $7
         on conflict (ledger_id) do nothing returning *),
       a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
         select $1, 'ledger', c.ledger_id::text, jsonb_build_object('checked', c.state)
           || case when c.note is null then '{}'::jsonb else jsonb_build_object('note', c.note) end, $3 from c)
     select l.created_by as adder, l.type, l.amount_poisha::int as amount from c join ledger l on l.id = c.ledger_id`,
    [flatId, id, by.memberId, state, reason, today, rv]);
  return r ?? null;
}

/** SQL: could `me` fix ledger row `l` (its month row `mo`) today once it is sent back? Its month open, `me` living here today
 *  (as may_check and sign-in), and the collector (any open month) or whoever added it in its own month: the rule fixEntry keeps. */
const fixer = (me: string, today: string) =>
  `(mo.status = 'open' and ${adderHere(me, today, `l.created_by = ${me} and l.month = date_trunc('month', ${today}::text::date)::date`)})`;
/** SQL: `me` lives here today and is the collector or `adder` holds. */
const adderHere = (me: string, today: string, adder: string) => `exists (select 1 from members w where w.flat_id = l.flat_id and w.id = ${me}
  and (w.left_on is null or w.left_on >= ${today}::text::date) and (w.role = 'manager' or (${adder})))`;
/** SQL: may `me` add or change the receipt photo of `l` now (Late receipt): still waiting (no check `c`), its month open, and
 *  the collector or whoever added it (any open month: no money moves), living here today. */
const mayReceipt = (me: string, today: string) => `(c.ledger_id is null and mo.status = 'open' and ${adderHere(me, today, `l.created_by = ${me}`)})`;
/** SQL: may `me` Fix it on `l` now: sent back (its check `c`) and `fixer`. */
const mayFix = (me: string, today: string) => `(c.state = 'fix' and ${fixer(me, today)})`;

/** Who a Needs correction push goes to: whoever added it if they may fix it (mayFix), else the collector; never `marker`,
 *  the one who marked it. Null: nobody. */
export async function fixAskTo(db: Db, flatId: string, id: string, marker: string, today: string) {
  const [r] = await db<{ to: string | null }>(
    `select case when ${mayFix('l.created_by', '$3')} then l.created_by
       else (select id from members where flat_id = l.flat_id and role = 'manager') end as to
     from ledger l join months mo on mo.flat_id = l.flat_id and mo.month = l.month left join entry_checks c on c.ledger_id = l.id
     where l.flat_id = $1 and l.id = $2`, [flatId, id, today]);
  return r?.to && r.to !== marker ? r.to : null;
}

/** Unusual amount (trust feature 3): how many times a usual bazar this one is, when at least twice, else null. */
export const unusualRatio = (amount: number, usual: number | null) =>
  usual && amount >= 2 * usual ? Math.round((amount / usual) * 10) / 10 : null;
/** SQL: the usual bazar for entry `l`: the median of the flat's other bazars dated in the 60 days up to it, at least 5 of
 *  them; null otherwise and for a bill (their amounts differ by nature: rent, gas). */
const usual = (l: string) => `case when ${l}.type = 'bazar' then (select percentile_cont(0.5) within group (order by u.amount_poisha)
  from ledger u where u.flat_id = ${l}.flat_id and u.type = 'bazar' and u.status = 'ok' and u.id <> ${l}.id
    and u.date between ${l}.date - 60 and ${l}.date having count(*) >= 5)::float8 end`;

/** Bazars and bills of open months for this person: waiting ones may_check lets them check (the collector: everyone else's;
 *  a flatmate: the collector's own, monthly bills included), and entries sent back that are theirs to fix, with the reason:
 *  their own, and for the collector also any its adder can't fix (an earlier month's, or the adder moved out), as fixAskTo. */
export const toCheck = (db: Db, flatId: string, memberId: string, today: string) => db<{
  id: string; type: 'bazar' | 'bill'; amount: number; date: string; note: string | null; state: 'fix' | null; reason: string | null; usual: number | null;
}>(
  `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.note, c.state, c.note as reason, ${usual('l')} as usual
   from ledger l join months mo on mo.flat_id = l.flat_id and mo.month = l.month and mo.status = 'open'
   left join entry_checks c on c.ledger_id = l.id
   where l.flat_id = $1 and l.type in ('bazar', 'bill') and l.status = 'ok'
     and ((c.ledger_id is null and may_check(l.id, $2, $3::text::date)) or (${mayFix('$2', '$3')}
       and (l.created_by = $2 or not ${fixer('l.created_by', '$3')})))
   order by l.date, l.created_at`, [flatId, memberId, today]);

export type Detail = {
  id: string; type: 'bazar' | 'bill'; amount: number; date: string; month: string; note: string | null; paidBy: string | null;
  createdBy: string; addedBy: string; addedAt: string; open: boolean; check: 'ok' | 'fix' | null; reason: string | null;
  checkedBy: string | null; checkedAt: string | null; receiptV: string | null; mayCheck: boolean; mayFix: boolean; adderMayFix: boolean; mayAddReceipt: boolean; items: Item[]; usual: number | null;
};
/** One bazar or bill for its page: its lines, receipt and check, whether `me` may check it now (open month, no check yet, may_check) or fix it, whether its adder may fix it (Send back names
 *  them only then; else the collector fixes it, as fixAskTo), and the flat's people
 *  (Fix it's Who paid). Null for anything not a bazar or bill of this flat. */
export async function entryDetail(db: Db, flatId: string, id: string, me: string, today: string) {
  const [d] = await db<Detail>(
    `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.month::text as month, l.note, l.paid_by_member_id as "paidBy",
       l.created_by as "createdBy", a.name as "addedBy", l.created_at::text as "addedAt", mo.status = 'open' as open,
       c.state as "check", c.note as reason, cb.name as "checkedBy", c.at::text as "checkedAt",
       extract(epoch from r.created_at)::bigint::text as "receiptV", mo.status = 'open' and c.ledger_id is null
         and coalesce(may_check(l.id, $3, $4::text::date), false) as "mayCheck",
       coalesce(${mayFix('$3', '$4')}, false) as "mayFix", coalesce(${fixer('l.created_by', '$4')}, false) as "adderMayFix",
       coalesce(${mayReceipt('$3', '$4')}, false) as "mayAddReceipt",
       ${usual('l')} as usual,
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

export type Fix = { id: string; type: 'bazar' | 'bill'; amount: number; date: string; paidBy: string | null; note: string | null; items: Item[]; receipt: Uint8Array | null };

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
  // the posted type must be the entry's own: a stale bill form on a bazar would post no item lines and wipe them
  if (!e || e.type !== f.type || (e.type === 'bill' && (!f.note || f.items.length))) return { result: 'bad' };
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

/** Late receipt: a receipt photo added or changed on a waiting bazar or bill (mayReceipt). Only `receipts` and a history row
 *  are written, never `ledger`, so no version moves (a close card and a handover offer stay valid); created_at = now() so
 *  phones fetch the new photo. One statement that locks the month row (no key update, as checkEntry) and needs it open, so
 *  nothing lands on a month that just closed. */
export async function addReceipt(db: Db, flatId: string, by: Actor, id: string, bytes: Uint8Array, today: string): Promise<'ok' | 'bad' | 'receipt'> {
  if (!isJpeg(bytes, MAX_RECEIPT)) return 'receipt';
  const r = await db(
    `with e as (select l.id, l.month from ledger l join months mo on mo.flat_id = l.flat_id and mo.month = l.month
         left join entry_checks c on c.ledger_id = l.id
         where l.flat_id = $1 and l.id = $2 and l.type in ('bazar', 'bill') and l.status = 'ok' and ${mayReceipt('$3', '$5')}
         for no key update of mo),
       r as (insert into receipts (flat_id, ledger_id, month, photo) select $1, e.id, e.month, $4::bytea from e
         on conflict (ledger_id) do update set photo = excluded.photo, created_at = now() returning ledger_id),
       a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
         select $1, 'ledger', r.ledger_id::text, '{"receipt":true}'::jsonb, $3 from r)
     select 1 from r`, [flatId, id, by.memberId, Buffer.from(bytes), today]);
  return r.length ? 'ok' : 'bad';
}

/** SQL (unaliased `ledger`): a row that keeps month `m` from closing. Money waiting for a tap, in this or a later open month
 *  (the caller limits to month >= m): it is in the hand but not in the books. Or a bazar or bill of month `m` itself that
 *  isn't Verified (waiting or Needs correction), until the 3rd of the next month: from the 4th (`today`, a SQL date) the
 *  month closes anyway and those show as Closed without a check. A later month's are checked before that month closes. */
export const blocksClose = (m: string, today: string) => `(status = 'pending' or (month = ${m} and type in ('bazar', 'bill')
  and ${today} < (${m} + interval '1 month' + interval '3 days')::date
  and not exists (select 1 from entry_checks c where c.ledger_id = ledger.id and c.state = 'ok')))`;

/** A month's checks for its month-end message (trust feature 4): who Verified how many of its bazars and bills, most first;
 *  how many have no check and how many are sent back. A check with no name kept (020's backfill) counts in no one's total. */
export async function monthChecks(db: Db, flatId: string, month: string) {
  const rows = await db<{ name: string | null; state: 'ok' | 'fix' | null; n: number }>(
    `select m.name, c.state, count(*)::int as n from ledger l
       left join entry_checks c on c.ledger_id = l.id
       left join members m on m.flat_id = c.flat_id and m.id = c.by_member
     where l.flat_id = $1 and l.month = $2::text::date and l.type in ('bazar', 'bill') and l.status = 'ok'
     group by m.id, m.name, c.state order by n desc, m.name`, [flatId, month]);
  const sum = (s: 'fix' | null) => rows.filter(r => r.state === s).reduce((a, r) => a + r.n, 0);
  return { by: rows.filter(r => r.state === 'ok' && r.name).map(r => ({ name: r.name!, n: r.n })), none: sum(null), fix: sum('fix') };
}
