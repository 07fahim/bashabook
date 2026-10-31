import { randomBytes, randomInt } from 'node:crypto';
import type { Db } from './db';
import { hashPin, hashToken, STAYING, UUID } from './auth';

/** Forgot the flat code or PIN: a 6-digit code by email, typed on the page that asked (so it works in the installed app
 *  too). The browser keeps the step's token in this httpOnly cookie; the database keeps its sha256. */
export const RECOVER_COOKIE = 'recover';
export const CODE_MINUTES = 10, PROVEN_MINUTES = 15, TRIES = 5, PER_DAY = 5;

/** "Send me a code": a new step with a random code for this email, made the same way whether or not anyone has the email,
 *  so the screen never tells. `send`: a person still living in a flat has it (only then is the code emailed). Null once
 *  this email had PER_DAY codes in 24 hours: 5 tries each, 25 guesses a day at a million codes.
 *  ponytail: requests at the same instant can each pass the count. The per-connection limit bounds that for one IP only:
 *  a parallel burst from many IPs can go past PER_DAY. Upgrade path: count with an atomic upsert. */
export async function startRecovery(db: Db, email: string): Promise<{ token: string; code: string; send: boolean } | null> {
  const token = randomBytes(32).toString('base64url'), code = String(randomInt(1_000_000)).padStart(6, '0');
  const [r] = await db<{ send: boolean }>(
    `with ins as (insert into recoveries (token_hash, email, code_hash, expires_at)
       select $1, $2, $3, now() + interval '${CODE_MINUTES} minutes'
       where (select count(*) from recoveries where email = $2 and created_at > now() - interval '1 day') < ${PER_DAY} returning 1)
     select exists (select 1 from members where email = $2 and ${STAYING}) as send from ins`,
    [hashToken(token), email, hashToken(code)]);
  return r ? { token, code, send: r.send } : null;
}

/** One try at the code, counted before it is checked (one statement, so parallel tries can't pass TRIES). Right: the step
 *  is proven for PROVEN_MINUTES and the email is confirmed on every account that has it (the inbox was just shown to be
 *  theirs). 'expired' covers gone, timed out, used up and already proven. */
export async function checkCode(db: Db, token: string, code: string): Promise<'ok' | 'expired' | { wrong: number }> {
  const [r] = await db<{ code_hash: string; tries: number }>(
    `update recoveries set tries = tries + 1 where token_hash = $1 and not proven and expires_at > now() and tries < ${TRIES}
     returning code_hash, tries`, [hashToken(token)]);
  if (!r) return 'expired';
  if (r.code_hash !== hashToken(code)) return { wrong: TRIES - r.tries };
  await db(
    `with p as (update recoveries set proven = true, expires_at = now() + interval '${PROVEN_MINUTES} minutes'
       where token_hash = $1 and not proven and expires_at > now() returning email)
     update members set email_ok = true, email_token = null where email in (select email from p) and ${STAYING}`, [hashToken(token)]);
  return 'ok';
}

/** The step this browser is on (the forgot page picks its screen from it); null when there is none or it ran out. */
export async function recoveryOf(db: Db, token: string) {
  const [r] = await db<{ email: string; proven: boolean }>(
    `select email, proven from recoveries where token_hash = $1 and expires_at > now() and (proven or tries < ${TRIES})`, [hashToken(token)]);
  return r ?? null;
}

/** The email this browser proved in the last PROVEN_MINUTES, else null. */
export async function provenEmail(db: Db, token: string) {
  const [r] = await db<{ email: string }>(`select email from recoveries where token_hash = $1 and proven and expires_at > now()`, [hashToken(token)]);
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
    `with p as (update recoveries r set expires_at = '-infinity' where token_hash = $1 and proven and expires_at > now()
       and exists (select 1 from members where id = $2 and email = r.email and ${STAYING}) returning email),
     m as (update members set pin_hash = $3, must_change_pin = false, failed_pin_count = 0, locked_until = null
       where id = $2 and email = (select email from p) and ${STAYING} returning id, flat_id),
     s as (delete from sessions where member_id in (select id from m)),
     a as (insert into audit_log (flat_id, entity, entity_id, after, by_member)
       select flat_id, 'members', id::text, '{"pinReset": true, "email": true}', id from m)
     select count(*)::int as n from m`, [hashToken(token), memberId, await hashPin(pin)]);
  return r.n > 0;
}

/** The step is done (signed in) or abandoned (another email): retired, not deleted, so it still counts toward PER_DAY until
 *  the cron sweeps it after a day. '-infinity', not now(): a call whose statement began a moment earlier still sees it ended. */
export const endRecovery = (db: Db, token: string) => db(`update recoveries set expires_at = '-infinity' where token_hash = $1`, [hashToken(token)]);
