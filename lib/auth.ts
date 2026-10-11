import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { Db } from './db';

export const SESSION_DAYS = 90;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I/L
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const cleanName = (v: unknown) => { const s = String(v ?? '').trim(); return s.length >= 1 && s.length <= 40 ? s : null; };
export const isPin = (v: unknown) => /^\d{4}$/.test(String(v ?? ''));
const hashPin = (pin: string) => bcrypt.hash(pin, 10);
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
/** Still living here: no last day, or it hasn't passed yet (in Dhaka). Someone who moved out can't sign in or be picked. */
const STAYING = "(left_on is null or left_on >= (now() at time zone 'Asia/Dhaka')::date)";
/** A name clash: unique, or the same name for two overlapping stays (one_name_per_stay). */
const nameClash = (e: unknown) => ['23505', '23P01'].includes((e as { code?: string }).code ?? '');
const newJoinCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

/** Flat, its starter (role manager, already claimed) and unclaimed names, in one statement. */
export async function createFlat(db: Db, f: { flatName: string; name: string; pin: string; others: string[]; today: string; lang: 'bn' | 'en' }) {
  const others = [...new Set(f.others)].filter(n => n !== f.name);
  // ponytail: a join code clash (31^6 codes) fails the insert; add a retry if flats reach the hundreds of thousands
  const [row] = await db<{ flat_id: string; member_id: string }>(
    `with f as (insert into flats (name, join_code, language) values ($1, $2, $7) returning id),
     m as (insert into members (flat_id, name, pin_hash, role, joined_on) select id, $3::text, $4::text, 'manager', $5::date from f returning id),
     o as (insert into members (flat_id, name, joined_on) select f.id, n, $5::date from f, json_array_elements_text($6::text::json) n)
     select f.id as flat_id, m.id as member_id from f, m`,
    [f.flatName, newJoinCode(), f.name, await hashPin(f.pin), f.today, JSON.stringify(others), f.lang]);
  return { flatId: row.flat_id, memberId: row.member_id };
}

/** The collector makes a new join code (the link got shared outside the flat): the old link stops working at once, and
 *  everyone signed in stays signed in (sessions don't depend on the code). The history says so, without the code. */
export async function newFlatCode(db: Db, flatId: string, by: { memberId: string; role: 'member' | 'manager' }, gen = newJoinCode) {
  if (by.role !== 'manager') return null;
  for (let i = 0; i < 3; i++) {
    const code = gen();
    try {
      const rows = await db<{ code: string }>(
        `with f as (update flats set join_code = $2 where id = $1
             and exists (select 1 from members where flat_id = $1 and id = $3 and role = 'manager') returning join_code),
         a as (insert into audit_log (flat_id, entity, entity_id, after, by_member) select $1, 'flats', 'flat|code', '{"codeChanged": true}', $3 from f)
         select join_code as code from f`, [flatId, code, by.memberId]);
      return rows[0]?.code ?? null;
    } catch (e) {
      if ((e as { code?: string }).code !== '23505') throw e;   // that code belongs to another flat: draw again
    }
  }
  return null;
}

export async function flatByCode(db: Db, code: string) {
  const [flat] = await db<{ id: string; name: string }>(`select id, name from flats where join_code = $1`, [code.toUpperCase()]);
  if (!flat) return null;
  const members = await db<{ id: string; name: string; claimed: boolean; must_change_pin: boolean; joinedOn: string; leftOn: string | null }>(
    `select id, name, pin_hash is not null as claimed, must_change_pin, joined_on::text as "joinedOn", left_on::text as "leftOn" from members where flat_id = $1 and ${STAYING} order by name`, [flat.id]);
  return { ...flat, members };
}

export type LoginError = 'notFound' | 'taken' | 'locked' | 'wrongPin' | 'newPinNeeded';

/** Counts a PIN try before it is checked, in one statement, so parallel guesses can't slip past the lock.
 *  Every 5th wrong try locks for longer (15 min, 30, 1 h …). False = locked right now. */
async function countTry(db: Db, memberId: string) {
  const tried = await db(
    `update members set failed_pin_count = failed_pin_count + 1,
       locked_until = case when (failed_pin_count + 1) % 5 = 0
         then now() + interval '15 minutes' * power(2, least((failed_pin_count + 1) / 5 - 1, 4)) else locked_until end
     where id = $1 and (locked_until is null or locked_until <= now()) returning id`, [memberId]);
  return tried.length > 0;
}

/** Claims an unclaimed name, or checks the PIN with lockout. newPin is required after a reset. */
export async function login(db: Db, code: string, memberId: string, pin: string, newPin: string | null): Promise<{ memberId: string } | { error: LoginError }> {
  if (!UUID.test(memberId)) return { error: 'notFound' };
  const [m] = await db<{ pin_hash: string | null; must_change_pin: boolean }>(
    `select m.pin_hash, m.must_change_pin from members m join flats f on f.id = m.flat_id where f.join_code = $1 and m.id = $2 and ${STAYING}`, [code.toUpperCase(), memberId]);
  if (!m) return { error: 'notFound' };
  if (m.pin_hash === null) {
    const claimed = await db(`update members set pin_hash = $2 where id = $1 and pin_hash is null returning id`, [memberId, await hashPin(pin)]);
    return claimed.length ? { memberId } : { error: 'taken' };
  }
  if (!(await countTry(db, memberId))) return { error: 'locked' };
  if (!(await bcrypt.compare(pin, m.pin_hash))) return { error: 'wrongPin' };
  if (m.must_change_pin && !newPin) {
    await db(`update members set failed_pin_count = 0, locked_until = null where id = $1`, [memberId]);
    return { error: 'newPinNeeded' };
  }
  // pin_hash = the one we checked, so a reset that lands mid-login wins
  const done = await db(
    `update members set failed_pin_count = 0, locked_until = null, pin_hash = coalesce($2, pin_hash), must_change_pin = false
     where id = $1 and pin_hash = $3 returning id`,
    [memberId, m.must_change_pin ? await hashPin(newPin!) : null, m.pin_hash]);
  return done.length ? { memberId } : { error: 'notFound' };
}

export async function createSession(db: Db, memberId: string) {
  const token = randomBytes(32).toString('base64url');
  await db(`delete from sessions where expires_at < now()`);
  await db(`insert into sessions (token_hash, member_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hashToken(token), memberId]);
  return token;
}

export type Me = { memberId: string; flatId: string; role: 'member' | 'manager'; name: string; flatName: string; joinCode: string; lang: 'bn' | 'en' };

export async function memberBySession(db: Db, token: string): Promise<Me | null> {
  const [me] = await db<Me>(
    `select m.id as "memberId", m.flat_id as "flatId", m.role, m.name, f.name as "flatName", f.join_code as "joinCode", f.language as lang
     from sessions s join members m on m.id = s.member_id join flats f on f.id = m.flat_id
     where s.token_hash = $1 and s.expires_at > now() and ${STAYING}`, [hashToken(token)]);
  return me ?? null;
}

export const deleteSession = (db: Db, token: string) => db(`delete from sessions where token_hash = $1`, [hashToken(token)]);

export const listMembers = (db: Db, flatId: string) => db<{ id: string; name: string; claimed: boolean; failed: number; locked: boolean; phone: string | null; photoV: number | null; joinedOn: string; leftOn: string | null }>(
  `select id, name, phone, joined_on::text as "joinedOn", left_on::text as "leftOn", case when photo is null then null else photo_v end as "photoV", pin_hash is not null as claimed, failed_pin_count as failed, coalesce(locked_until > now(), false) as locked
   from members where flat_id = $1 and ${STAYING} order by role = 'manager' desc, name`, [flatId]);

export async function addMember(db: Db, flatId: string, name: string, today: string) {
  // the target must be named: one_manager_per_flat is deferrable (011) and can't be an on conflict arbiter
  const rows = await db(`insert into members (flat_id, name, joined_on) values ($1, $2, $3) on conflict on constraint one_name_per_stay do nothing returning id`, [flatId, name, today]);
  return rows.length > 0;
}

/** A Bangladeshi mobile number as typed ('+880 1712-345678', Bangla digits) → '01712345678', else null. */
export function normalizePhone(v: string): string | null {
  const d = v.replace(/[০-৯]/g, c => String('০১২৩৪৫৬৭৮৯'.indexOf(c))).replace(/[\s\-()+]/g, '');
  return /^(?:88)?(01[3-9]\d{8})$/.exec(d)?.[1] ?? null;
}

/** My own mobile number, or null to remove it. Everyone in the flat sees it. */
export const setPhone = (db: Db, memberId: string, phone: string | null) => db(`update members set phone = $2 where id = $1`, [memberId, phone]);

/** I change my own PIN with my current one. Wrong tries count toward the login lockout. My other phones are signed out,
 *  the one I'm using (`keepToken`) stays in. */
export async function changePin(db: Db, memberId: string, current: string, next: string, keepToken: string): Promise<'ok' | 'locked' | 'wrongPin'> {
  const [m] = await db<{ pin_hash: string | null }>(`select pin_hash from members where id = $1`, [memberId]);
  if (!(await countTry(db, memberId))) return 'locked';
  if (!m?.pin_hash || !(await bcrypt.compare(current, m.pin_hash))) return 'wrongPin';
  // pin_hash = the one we checked, so a reset that lands at the same moment wins (and nothing else changes)
  const done = await db(`update members set pin_hash = $2, failed_pin_count = 0, locked_until = null, must_change_pin = false
    where id = $1 and pin_hash = $3 returning id`, [memberId, await hashPin(next), m.pin_hash]);
  if (!done.length) return 'wrongPin';
  await db(`delete from sessions where member_id = $1 and token_hash <> $2`, [memberId, hashToken(keepToken)]);
  return 'ok';
}

/** The person who runs the flat fixes a name. Refused if someone in the flat already has it; the change goes in the history. */
export async function renameMember(db: Db, flatId: string, by: string, memberId: string, name: string): Promise<'ok' | 'taken' | 'notFound'> {
  if (!UUID.test(memberId)) return 'notFound';
  try {
    const [r] = await db<{ found: boolean }>(
      `with old as (select name from members where flat_id = $1 and id = $2),
       up as (update members set name = $3 where flat_id = $1 and id = $2 and name <> $3 returning name),
       log as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
         select $1, 'members', $2::text, jsonb_build_object('rename', jsonb_build_array(old.name, up.name)), $4 from old, up)
       select exists (select 1 from old) as found`, [flatId, memberId, name, by]);
    return r.found ? 'ok' : 'notFound';   // the same name again changes nothing and writes no history
  } catch (e) {
    // one name per stay: the database decides, so two renames at the same moment can't both take a name
    if (nameClash(e)) return 'taken';
    throw e;
  }
}

/** The person who runs the flat sets someone's last day here, or takes it back (null). Never their own: they hand the flat over first.
 *  Only today or later, so a day already cooked never changes, and only while that person still lives here. */
export async function setLeaving(db: Db, flatId: string, by: string, memberId: string, lastDay: string | null, today: string): Promise<'ok' | 'no' | 'taken'> {
  if (!UUID.test(memberId)) return 'no';
  try {
    const [r] = await db<{ r: 'ok' | 'no' }>(`select set_leaving($1, $2, $3, $4::date, $5::date) as r`, [flatId, by, memberId, lastDay, today]);
    return r.r;   // the same day again changes nothing and writes no history; a caller who is no longer collector gets 'no'
  } catch (e) {
    if (nameClash(e)) return 'taken';   // taking it back while a newcomer has the same name
    throw e;
  }
}

/** People who moved out recently (last day on or after `from`, the first day meals can still be fixed), newest first:
 *  only here can a departure marked by mistake be undone. Someone who left long ago and comes back is added as new. */
export const listGone = (db: Db, flatId: string, from: string) => db<{ id: string; name: string; leftOn: string }>(
  `select id, name, left_on::text as "leftOn" from members where flat_id = $1 and not ${STAYING} and left_on >= $2::date
   order by left_on desc, name`, [flatId, from]);

/** Brings back someone marked as moved out by mistake, without changing a day already cooked: every day from the day after
 *  the old last day through today is saved as no meals for them, so they count again only from tomorrow. History says so. */
export async function bringBack(db: Db, flatId: string, by: string, memberId: string, today: string, from: string): Promise<'ok' | 'no' | 'taken'> {
  if (!UUID.test(memberId)) return 'no';
  try {
    const [r] = await db<{ ok: boolean }>(
      `with m as (select id, left_on from members where flat_id = $1 and id = $2 and left_on < $3::date and left_on >= $5::date),
       up as (update members set left_on = null where id in (select id from m) and left_on is not null returning id),
       -- ponytail: cancelling no-cooking for one of these past days later gives them their usual meal back; that day was cooked
       -- with them living here, so it stands. Skip no-cooking days here if pilot flats find it wrong.
       fill as (insert into meal_changes (flat_id, member_id, date, meal, count)
         select $1::uuid, m.id, d::date, x, 0
         from m, generate_series((m.left_on + 1)::timestamp, $3::text::timestamp, interval '1 day') d, unnest(array['b','l','d']) x
         on conflict (member_id, date, meal) do update set count = 0, guests = 0, late = false, updated_at = now()),
       log as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
         select $1, 'members', $2::text, jsonb_build_object('back', jsonb_build_array((m.left_on + 1)::text, $3::text)), $4 from m join up using (id))
       select exists (select 1 from up) as ok`, [flatId, memberId, today, by, from]);
    return r.ok ? 'ok' : 'no';
  } catch (e) {
    if (nameClash(e)) return 'taken';   // someone living here now has the same name
    throw e;
  }
}

/** Sets a one-time PIN: the next sign-in must choose a new one. Every phone is signed out and the flat's history says so.
 *  `by`: the collector resetting a flatmate in the app, or the app team (scripts/reset-collector-pin.mts), which may reset
 *  only the collector living here now and must give a reason. In the app only the collector, never their own PIN, and only
 *  someone living here now. Only PIN fields change: never the role, money or meals. */
export async function resetPin(db: Db, flatId: string, memberId: string, pin: string, by: { memberId: string } | { admin: string; reason: string }) {
  if (!UUID.test(memberId)) return false;
  const team = 'admin' in by ? by : null;
  if (team && (!team.admin.trim() || !team.reason.trim())) return false;
  const [r] = await db<{ n: number }>(
    `with m as (update members set pin_hash = $3, must_change_pin = true, failed_pin_count = 0, locked_until = null
       where flat_id = $1 and id = $2 and ${STAYING} and case when $5::text is null
         then id <> $4::uuid and exists (select 1 from members c where c.flat_id = $1 and c.id = $4::uuid and c.role = 'manager')
         else role = 'manager' end returning id),
     s as (delete from sessions where member_id in (select id from m)),
     a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
       select $1, 'members', m.id::text, case when $5::text is null then '{"pinReset": true}'::jsonb
         else jsonb_build_object('pinReset', true, 'admin', $5::text, 'reason', $6::text) end, $4::uuid from m)
     select count(*)::int as n from m`,
    [flatId, memberId, await hashPin(pin), team ? null : (by as { memberId: string }).memberId, team?.admin ?? null, team?.reason ?? null]);
  return r.n > 0;
}
