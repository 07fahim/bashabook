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
const newJoinCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

/** Flat, its starter (role manager, already claimed) and unclaimed names, in one statement. */
export async function createFlat(db: Db, f: { flatName: string; name: string; pin: string; others: string[]; today: string; lang: 'bn' | 'en' }) {
  const others = [...new Set(f.others)].filter(n => n !== f.name);
  // ponytail: a join code clash (31^6 codes) fails the insert; add a retry if flats reach the hundreds of thousands
  const [row] = await db<{ flat_id: string; member_id: string }>(
    `with f as (insert into flats (name, join_code, language) values ($1, $2, $7) returning id),
     m as (insert into members (flat_id, name, pin_hash, role, joined_on) select id, $3::text, $4::text, 'manager', $5::date from f returning id),
     o as (insert into members (flat_id, name, joined_on) select f.id, n, $5::date from f, json_array_elements_text($6::json) n)
     select f.id as flat_id, m.id as member_id from f, m`,
    [f.flatName, newJoinCode(), f.name, await hashPin(f.pin), f.today, others, f.lang]);
  return { flatId: row.flat_id, memberId: row.member_id };
}

export async function flatByCode(db: Db, code: string) {
  const [flat] = await db<{ id: string; name: string }>(`select id, name from flats where join_code = $1`, [code.toUpperCase()]);
  if (!flat) return null;
  const members = await db<{ id: string; name: string; claimed: boolean; must_change_pin: boolean }>(
    `select id, name, pin_hash is not null as claimed, must_change_pin from members where flat_id = $1 order by name`, [flat.id]);
  return { ...flat, members };
}

export type LoginError = 'notFound' | 'taken' | 'locked' | 'wrongPin' | 'newPinNeeded';

/** Claims an unclaimed name, or checks the PIN with lockout. newPin is required after a reset. */
export async function login(db: Db, code: string, memberId: string, pin: string, newPin: string | null): Promise<{ memberId: string } | { error: LoginError }> {
  if (!UUID.test(memberId)) return { error: 'notFound' };
  const [m] = await db<{ pin_hash: string | null; must_change_pin: boolean }>(
    `select m.pin_hash, m.must_change_pin from members m join flats f on f.id = m.flat_id where f.join_code = $1 and m.id = $2`, [code.toUpperCase(), memberId]);
  if (!m) return { error: 'notFound' };
  if (m.pin_hash === null) {
    const claimed = await db(`update members set pin_hash = $2 where id = $1 and pin_hash is null returning id`, [memberId, await hashPin(pin)]);
    return claimed.length ? { memberId } : { error: 'taken' };
  }
  // Count the try before checking it, in one statement, so parallel guesses can't slip past the lock.
  const tried = await db(
    `update members set failed_pin_count = failed_pin_count + 1,
       locked_until = case when (failed_pin_count + 1) % 5 = 0
         then now() + interval '15 minutes' * power(2, least((failed_pin_count + 1) / 5 - 1, 4)) else locked_until end
     where id = $1 and (locked_until is null or locked_until <= now()) returning id`, [memberId]);
  if (!tried.length) return { error: 'locked' };
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
     where s.token_hash = $1 and s.expires_at > now()`, [hashToken(token)]);
  return me ?? null;
}

export const deleteSession = (db: Db, token: string) => db(`delete from sessions where token_hash = $1`, [hashToken(token)]);

export const listMembers = (db: Db, flatId: string) => db<{ id: string; name: string; claimed: boolean; failed: number; locked: boolean }>(
  `select id, name, pin_hash is not null as claimed, failed_pin_count as failed, coalesce(locked_until > now(), false) as locked
   from members where flat_id = $1 order by role = 'manager' desc, name`, [flatId]);

export async function addMember(db: Db, flatId: string, name: string, today: string) {
  const rows = await db(`insert into members (flat_id, name, joined_on) values ($1, $2, $3) on conflict (flat_id, name) do nothing returning id`, [flatId, name, today]);
  return rows.length > 0;
}

export async function resetPin(db: Db, flatId: string, memberId: string, pin: string) {
  if (!UUID.test(memberId)) return false;
  const rows = await db(
    `update members set pin_hash = $3, must_change_pin = true, failed_pin_count = 0, locked_until = null where flat_id = $1 and id = $2 returning id`,
    [flatId, memberId, await hashPin(pin)]);
  if (rows.length) await db(`delete from sessions where member_id = $1`, [memberId]);
  return rows.length > 0;
}
