import type { Db } from './db';
import { daysOfMonth, daysPresent, isPresent, weightedMeals } from './meals';
import { loadMeals } from './meals-db';
import { monthBalances, type LedgerRow, type Split } from './money';

export type Entry = LedgerRow & { date: string; note: string | null; createdBy: string };
export type Room = { id: string; name: string; rentShare: number };
export type Removed = { at: string; by: string; type: LedgerRow['type']; amount: number; date: string; note: string | null };

export const monthOf = (date: string) => `${date.slice(0, 8)}01`;

/** Makes sure the month exists. The first time, it copies the monthly bills into it, paid from flat money and added by the
 *  collector (whoever happens to open the page first must not own, or be able to remove, the flat's rent). Safe to call again.
 *  One statement: the month, its bills, their people and their history rows are created together or not at all, so a failure
 *  leaves no month and the next call tries again; two people opening the month at once can't both copy (one wins the month row). */
export async function openMonth(db: Db, flatId: string, month: string) {
  await db(
    `with m as (insert into months (flat_id, month) values ($1, $2::date) on conflict do nothing returning month),
     c as (select id from members where flat_id = $1 and role = 'manager'),
     here as (select id from members where flat_id = $1
       and joined_on <= ($2::date + interval '1 month' - interval '1 day')::date and (left_on is null or left_on >= $2::date)),
     t as (select gen_random_uuid() as lid, b.name, b.amount_poisha, b.split,
             array(select x from unnest(b.selected_member_ids) x where x in (select id from here)) as sel   -- people who left are dropped
           from bill_templates b, m where b.flat_id = $1),
     ok as (select * from t where split <> 'selected' or cardinality(sel) > 0),
     l as (insert into ledger (id, flat_id, month, type, amount_poisha, split, date, note, status, created_by)
           select lid, $1, $2::date, 'bill', amount_poisha, split, $2::date, name, 'ok', (select id from c) from ok returning *),
     s as (insert into bill_split_members (flat_id, ledger_id, member_id) select $1, ok.lid, unnest(ok.sel) from ok where ok.split = 'selected')
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text, to_jsonb(l), l.created_by from l`,
    [flatId, month]);
}

/** One ledger row, its split people, its history row and (if `repeat`) its monthly template, all in one statement,
 *  so a bill can never be saved without the repeat the person ticked, or the other way round. Callers check the rules. */
async function insertEntry(db: Db, flatId: string, by: string,
  e: { type: LedgerRow['type']; amount: number; date: string; note: string | null; paidBy: string | null; memberId: string | null; split: Split | null; selected: string[] },
  status: 'ok' | 'pending', repeat: { split: Split; selected: string[] } | null = null) {
  await db(
    `with l as (insert into ledger (flat_id, month, type, amount_poisha, paid_by_member_id, member_id, split, date, note, status, created_by)
       values ($1, date_trunc('month', $2::date)::date, $3, $4, $5, $6, $7, $2, $8, $9, $10) returning *),
     s as (insert into bill_split_members (flat_id, ledger_id, member_id) select $1, l.id, x::uuid from l, json_array_elements_text($11::text::json) x),
     t as (insert into bill_templates (flat_id, name, amount_poisha, split, selected_member_ids)
       select $1, $8, $4, $12, array(select json_array_elements_text($13::text::json)::uuid) where $14::boolean)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text, to_jsonb(l), $10 from l`,
    [flatId, e.date, e.type, e.amount, e.paidBy, e.memberId, e.split, e.note, status, by, JSON.stringify(e.split === 'selected' ? e.selected : []),
     repeat?.split ?? 'equal', JSON.stringify(repeat?.selected ?? []), repeat !== null]);
}

/** Everything the money screens need for one month. Numbers so far: meals up to today, no carry-over until Plan 6 closes months. */
export async function loadMonth(db: Db, flatId: string, month: string, today: string) {
  if (month === monthOf(today)) await openMonth(db, flatId, month);
  const end = daysOfMonth(month).at(-1)!, upTo = today < end ? today : end;
  const { flat, members: everyone, changes } = await loadMeals(db, flatId, month, end);   // meals must come through loadMeals (no cooking)
  const roomOf = new Map((await db<{ id: string; roomId: string | null }>(
    `select id, room_id as "roomId" from members where flat_id = $1`, [flatId])).map(m => [m.id, m.roomId]));
  const all = everyone.map(m => ({ ...m, roomId: roomOf.get(m.id) ?? null }));
  const members = all.filter(m => m.joinedOn <= end && (m.leftOn === null || m.leftOn >= month));
  const rooms = await db<Room>(`select id, name, rent_share_poisha::int as "rentShare" from rooms where flat_id = $1 order by name`, [flatId]);
  const entries = await db<Entry>(
    `select l.id, l.type, l.amount_poisha::int as amount, l.paid_by_member_id as "paidBy", l.member_id as "memberId", l.split, l.status,
       l.date::text as date, l.note, l.created_by as "createdBy",
       (select coalesce(json_agg(s.member_id), '[]'::json) from bill_split_members s where s.ledger_id = l.id) as selected
     from ledger l where l.flat_id = $1 and l.month = $2 order by l.date desc, l.created_at desc`, [flatId, month]);
  const removed = await db<Removed>(
    `select a.at, m.name as by, a.before->>'type' as type, (a.before->>'amount_poisha')::int as amount, a.before->>'date' as date, a.before->>'note' as note
     from audit_log a join members m on m.flat_id = a.flat_id and m.id = a.by_member
     where a.flat_id = $1 and a.entity = 'ledger' and a.after->>'removed' = 'true' and a.before->>'month' = $2 order by a.id desc`, [flatId, month]);
  const meals = weightedMeals(members, changes, month, flat.weights, upTo);
  const guestMeals = new Map(members.map(m => [m.id, changes
    .filter(c => c.memberId === m.id && c.date <= upTo && isPresent(m, c.date))
    .reduce((s, c) => s + c.guests * flat.weights[c.meal], 0)]));
  const result = monthBalances({
    memberIds: members.map(m => m.id), opening: new Map(), openingFund: 0,
    weightedMeals: meals, daysPresent: daysPresent(members, month), roomOf, rooms, ledger: entries,
  });
  const first = monthOf(all.reduce((a, m) => (m.joinedOn < a ? m.joinedOn : a), month));
  return { flat, all, members, rooms, entries, removed, meals, guestMeals, result, first };
}

/** Rows waiting for this person's tap: deposits for the collector, money handed to me for me. `name` = who the row is for. */
export const toConfirm = (db: Db, flatId: string, memberId: string, boss: boolean) => db<{
  id: string; type: 'deposit' | 'payout'; amount: number; date: string; note: string | null; name: string;
}>(
  `select l.id, l.type, l.amount_poisha::int as amount, l.date::text as date, l.note, m.name
   from ledger l join members m on m.flat_id = l.flat_id and m.id = l.member_id
   where l.flat_id = $1 and l.status = 'pending' and ((l.type = 'deposit' and $3::boolean) or (l.type = 'payout' and l.member_id = $2))
   order by l.date, l.created_at`, [flatId, memberId, boss]);

export type Actor = { memberId: string; role: 'member' | 'manager' };
export type NewEntry = {
  type: LedgerRow['type']; amount: number; date: string; note: string | null;
  paidBy: string | null;          // bazar, bill: who paid the shop; null = flat money
  memberId: string | null;        // deposit: who paid in; payout: who got it
  split: Split | 'here' | null;   // bills only; 'here' = everyone living here on the bill date
  selected: string[];
  repeat?: boolean;               // bills, collector only: also copy it into every new month (from flat money)
};

/** Adds an entry if the rules allow it. 'rooms' = rent by room asked before rooms and rents are set. */
export async function addEntry(db: Db, flatId: string, by: Actor, e: NewEntry): Promise<'ok' | 'bad' | 'rooms'> {
  const boss = by.role === 'manager', moving = e.type === 'deposit' || e.type === 'payout';
  if (!Number.isInteger(e.amount) || e.amount <= 0) return 'bad';
  if ((e.type === 'bill') !== (e.split !== null)) return 'bad';
  if (moving ? !e.memberId || e.paidBy : e.memberId) return 'bad';
  if (e.type === 'payout' && !boss) return 'bad';                                  // only the collector hands out flat money
  if (e.type === 'deposit' && !boss && e.memberId !== by.memberId) return 'bad';   // members deposit only for themselves
  if (e.repeat && (!boss || e.type !== 'bill')) return 'bad';                      // monthly bills are the collector's
  const month = monthOf(e.date), end = daysOfMonth(month).at(-1)!;
  const here = await db<{ id: string; joinedOn: string; leftOn: string | null; roomId: string | null; gone: boolean }>(
    `select id, joined_on::text as "joinedOn", left_on::text as "leftOn", room_id as "roomId",
       left_on < (now() at time zone 'Asia/Dhaka')::date as gone from members
     where flat_id = $1 and joined_on <= $3 and (left_on is null or left_on >= $2)`, [flatId, month, end]);
  let split = e.split, selected = e.split === 'selected' ? e.selected : [];
  if (split === 'here') {
    split = 'selected';
    selected = here.filter(m => m.joinedOn <= e.date && (m.leftOn === null || m.leftOn >= e.date)).map(m => m.id);
  }
  if (split === 'selected' && !selected.length) return 'bad';
  const ids = new Set(here.map(m => m.id));
  if (![e.paidBy, e.memberId, ...selected].every(id => id === null || ids.has(id))) return 'bad';
  if (split === 'room') {
    const rooms = await db<{ id: string }>(`select id from rooms where flat_id = $1 and rent_share_poisha > 0`, [flatId]);
    if (!rooms.length || here.some(m => !m.roomId) || rooms.some(r => !here.some(m => m.roomId === r.id))) return 'rooms';
  }
  // money between two people waits for the receiver: the collector for deposits, the person for payouts. Someone who has
  // moved out can't sign in to confirm, so paying them back counts at once: the collector's entry is the record.
  const gone = here.some(m => m.id === e.memberId && m.gone);
  const pending = (e.type === 'deposit' && !boss) || (e.type === 'payout' && e.memberId !== by.memberId && !gone);
  await openMonth(db, flatId, month);
  // a repeated "everyone living here" bill becomes "everyone, by days": the people living here change month to month
  const repeat = e.repeat ? (split === 'selected' && e.split !== 'here' ? { split: 'selected' as const, selected } : { split: e.split === 'here' ? 'equal' as const : split!, selected: [] }) : null;
  await insertEntry(db, flatId, by.memberId, { ...e, split, selected }, pending ? 'pending' : 'ok', repeat);
  return 'ok';
}

/** The receiver's tap: the collector confirms deposits, the person who got the money confirms a payout. */
export async function confirmEntry(db: Db, flatId: string, by: Actor, id: string) {
  const r = await db(
    `with l as (update ledger set status = 'ok' where flat_id = $1 and id = $2 and status = 'pending'
       and ((type = 'deposit' and $4::boolean) or (type = 'payout' and member_id = $3)) returning id)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'ledger', l.id::text, '{"status":"ok"}', $3 from l returning 1`,
    [flatId, id, by.memberId, by.role === 'manager']);
  return r.length > 0;
}

/** Whoever added it, or the collector, removes an entry. A confirmed deposit only the collector: the cash is with them.
 *  The removed row is kept in the history, so the entries list can show it. */
export async function removeEntry(db: Db, flatId: string, by: Actor, id: string) {
  const r = await db(
    `with l as (delete from ledger where flat_id = $1 and id = $2
       and ($4::boolean or (created_by = $3 and (type <> 'deposit' or status = 'pending'))) returning *)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'ledger', l.id::text,
       -- the picked people are deleted with the entry, so they are kept in the record too
       to_jsonb(l) || jsonb_build_object('selected', (select coalesce(jsonb_agg(sm.member_id), '[]') from bill_split_members sm where sm.ledger_id = l.id)),
       '{"removed":true}', $3 from l returning 1`,
    [flatId, id, by.memberId, by.role === 'manager']);
  return r.length > 0;
}

/** Rooms and rent shares (collector only). Every change goes to the history: rent moves everyone's balance. */
export async function addRoom(db: Db, flatId: string, by: Actor, name: string, rent: number) {
  if (by.role !== 'manager' || !name.trim() || name.length > 40 || !Number.isInteger(rent) || rent < 0) return null;
  const [r] = await db<{ id: string }>(
    `with r as (insert into rooms (flat_id, name, rent_share_poisha) values ($1, $2, $3) returning *),
     a as (insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'rooms', r.id::text, to_jsonb(r), $4 from r)
     select id from r`, [flatId, name, rent, by.memberId]);
  return r.id;
}

export async function setRent(db: Db, flatId: string, by: Actor, roomId: string, rent: number) {
  if (by.role !== 'manager' || !Number.isInteger(rent) || rent < 0) return false;
  const done = await db(
    `with r as (update rooms set rent_share_poisha = $3 where flat_id = $1 and id = $2 returning *)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'rooms', r.id::text, to_jsonb(r), $4 from r returning 1`,
    [flatId, roomId, rent, by.memberId]);
  return done.length > 0;   // false: no such room in this flat
}

export async function setRoom(db: Db, flatId: string, by: Actor, memberId: string, roomId: string | null) {
  if (by.role !== 'manager') return false;
  const done = await db(
    `with m as (update members set room_id = $3 where flat_id = $1 and id = $2
       and ($3::uuid is null or exists (select 1 from rooms where flat_id = $1 and id = $3)) returning id, room_id)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'rooms', m.id::text, jsonb_build_object('roomId', m.room_id), $4 from m returning 1`,
    [flatId, memberId, roomId, by.memberId]);
  return done.length > 0;   // false: no such member, or no such room, in this flat
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
