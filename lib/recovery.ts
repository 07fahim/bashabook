import { randomBytes, randomInt } from 'node:crypto';
import type { Db } from './db';
import { hashPin, hashToken, STAYING, UUID } from './auth';
import { enDigits } from './money';

/** Forgot the flat code or PIN: an 8-digit code by email, typed on the page that asked (so it works in the installed app
 *  too). The browser keeps the step's token in this httpOnly cookie; the database keeps its sha256. */
export const RECOVER_COOKIE = 'recover';
/** Proving an email before it is saved: a new flat, claiming a name, adding or changing my email. Same codes and limits;
 *  the step's token lives in its own cookie and never works as a recovery token, nor the reverse. */
export type Check = 'new' | 'claim' | 'email';
export const CHECK_COOKIE = 'check';
export const CODE_MINUTES = 10, PROVEN_MINUTES = 15, TRIES = 5, PER_DAY = 100;
/** The typed code as its 8 digits (Bangla digits, spaces and a pasted label are fine), or null: refused before any try. */
export const codeOf = (v: unknown) => { const d = enDigits(String(v ?? '')).replace(/\D/g, ''); return d.length === 8 ? d : null; };

/** "Send me a code": a new step with a random code for this email, made the same way whether or not anyone has the email,
 *  so the screen never tells. `send`: a person still living in a flat has it (only then is the code emailed). Null once
 *  this email had PER_DAY codes in 24 hours: a backstop against many connections (5 tries each, 500 guesses a day at 100
 *  million codes). The everyday limit is per connection and email (the actions: 5 an hour), so a stranger who knows the
 *  email can't use up the owner's codes from the owner's own phone.
 *  ponytail: requests at the same instant can each pass the count, so a parallel burst can go a little past PER_DAY.
 *  Upgrade path: count with an atomic upsert. */
export const startRecovery = (db: Db, email: string) => start(db, email, 'recover', null);

/** A check step for an address about to be saved: always emailed (the person typed it themselves). `payload` is what to do
 *  once proven, never a plain PIN (a bcrypt hash). Null after PER_DAY codes for this email in 24 hours, recover and check
 *  steps together. */
export async function startCheck(db: Db, email: string, purpose: Check, payload: Record<string, unknown>): Promise<{ token: string; code: string } | null> {
  const r = await start(db, email, purpose, payload);
  return r && { token: r.token, code: r.code };
}

async function start(db: Db, email: string, purpose: 'recover' | Check, payload: Record<string, unknown> | null): Promise<{ token: string; code: string; send: boolean } | null> {
  const token = randomBytes(32).toString('base64url'), code = String(randomInt(100_000_000)).padStart(8, '0');
  const [r] = await db<{ send: boolean }>(
    `with ins as (insert into recoveries (token_hash, email, code_hash, expires_at, purpose, payload)
       select $1, $2, $3, now() + interval '${CODE_MINUTES} minutes', $4, $5::text::jsonb
       where (select count(*) from recoveries where email = $2 and created_at > now() - interval '1 day') < ${PER_DAY} returning 1)
     select exists (select 1 from members where email = $2 and ${STAYING}) as send from ins`,
    [hashToken(token), email, hashToken(code), purpose, payload && JSON.stringify(payload)]);
  return r ? { token, code, send: r.send } : null;
}

/** One try at the code, counted before it is checked (one statement, so parallel tries can't pass TRIES). Right: the step
 *  is proven for PROVEN_MINUTES. `kind`: a recover step answers only 'recover', a check step only 'check'. 'expired' covers
 *  gone, timed out, used up, already proven and the other kind. */
export async function checkCode(db: Db, token: string, code: string, kind: 'recover' | 'check'): Promise<'ok' | 'expired' | { wrong: number }> {
  const recover = kind === 'recover';
  const [r] = await db<{ code_hash: string; tries: number }>(
    `update recoveries set tries = tries + 1 where token_hash = $1 and not proven and expires_at > now() and tries < ${TRIES}
       and (purpose = 'recover') = $2 returning code_hash, tries`, [hashToken(token), recover]);
  if (!r) return 'expired';
  if (r.code_hash !== hashToken(code)) return { wrong: TRIES - r.tries };
  await db(
    `update recoveries set proven = true, expires_at = now() + interval '${PROVEN_MINUTES} minutes'
     where token_hash = $1 and not proven and expires_at > now() and (purpose = 'recover') = $2`, [hashToken(token), recover]);
  return 'ok';
}

/** The step this browser is on (the forgot page picks its screen from it); null when there is none or it ran out. */
export async function recoveryOf(db: Db, token: string) {
  const [r] = await db<{ email: string; proven: boolean }>(
    `select email, proven from recoveries where token_hash = $1 and purpose = 'recover' and expires_at > now() and (proven or tries < ${TRIES})`, [hashToken(token)]);
  return r ?? null;
}

/** The email this browser proved in the last PROVEN_MINUTES, else null. */
export async function provenEmail(db: Db, token: string) {
  const [r] = await db<{ email: string }>(`select email from recoveries where token_hash = $1 and purpose = 'recover' and proven and expires_at > now()`, [hashToken(token)]);
  return r?.email ?? null;
}

/** Every flat this email's person still lives in (or is about to move into), with its current code. */
export const flatsFor = (db: Db, email: string) => db<{ memberId: string; name: string; flatName: string; code: string }>(
  `select m.id as "memberId", m.name, f.name as "flatName", f.join_code as code from members m join flats f on f.id = m.flat_id
   where m.email = $1 and ${STAYING} order by f.name, m.name`, [email]);

/** A new PIN for the proven email's own person, still living there, in one statement: the PIN, no one-time PIN, no count,
 *  no lock (a permanent one too: the inbox proved who this is). Every phone of theirs is signed out and the flat's history
 *  says so (by them, "by email"). The step is claimed first, under its row lock and only when the member matches (a wrong id
 *  leaves it usable): a double tap waits on that lock, then finds it retired. False when anything doesn't match. */
export async function recoverPin(db: Db, token: string, memberId: string, pin: string) {
  if (!UUID.test(memberId)) return false;
  const [r] = await db<{ n: number }>(
    `with p as (update recoveries r set expires_at = '-infinity' where token_hash = $1 and purpose = 'recover' and proven and expires_at > now()
       and exists (select 1 from members where id = $2 and email = r.email and ${STAYING}) returning email),
     m as (update members set pin_hash = $3, must_change_pin = false, failed_pin_count = 0, locked_until = null
       where id = $2 and email = (select email from p) and ${STAYING} returning id, flat_id),
     s as (delete from sessions where member_id in (select id from m)),
     a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
       select flat_id, 'members', id::text, '{"pinReset": true, "email": true}', id from m)
     select count(*)::int as n from m`, [hashToken(token), memberId, await hashPin(pin)]);
  return r.n > 0;
}

/** The check step this browser is on, still waiting for its code; null when there is none, it ran out, is proven or is a
 *  recover step. */
export async function checkOf(db: Db, token: string) {
  const [r] = await db<{ email: string; purpose: Check; payload: Record<string, unknown> }>(
    `select email, purpose, payload from recoveries where token_hash = $1 and purpose <> 'recover' and not proven
       and expires_at > now() and tries < ${TRIES}`, [hashToken(token)]);
  return r ?? null;
}

/** A proven check step, handed over once: retired in the same statement, so a double tap waits on the row lock and then
 *  finds it retired. Null when it isn't proven, ran out, was taken or is a recover step. */
export async function takeCheck(db: Db, token: string) {
  const [r] = await db<{ email: string; purpose: Check; payload: Record<string, unknown> }>(
    `update recoveries set expires_at = '-infinity' where token_hash = $1 and proven and expires_at > now() and purpose <> 'recover'
     returning email, purpose, payload`, [hashToken(token)]);
  return r ?? null;
}

/** A step of either kind is done (signed in, saved) or abandoned (another email): retired, not deleted, so it still counts toward PER_DAY until
 *  the cron sweeps it after a day. '-infinity', not now(): a call whose statement began a moment earlier still sees it ended. */
export const endRecovery = (db: Db, token: string) => db(`update recoveries set expires_at = '-infinity' where token_hash = $1`, [hashToken(token)]);
