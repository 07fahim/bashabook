import { timingSafeEqual } from 'node:crypto';
import type { Locale } from '../app/[lang]/dictionaries';
import { blocksClose } from './bazar';
import type { Db } from './db';
import { monthOf } from './money-db';
import { checkMsg, closeMsg, lateMsg } from './notify-text';
import { sendPush } from './push';
import { SWEEP } from './rate-limit';

/** Claims one logical reminder: true for the first caller only (the primary key is the lock). */
const claim = async (db: Db, flatId: string, date: string, job: string) =>
  (await db(`insert into sent_jobs (flat_id, date, job_type) values ($1, $2, $3) on conflict do nothing returning 1`, [flatId, date, job])).length > 0;

/** Every 5 minutes from cron-job.org. `now` is Dhaka 'YYYY-MM-DDTHH:MM'. Postgres picks the flats with something due (two
 *  queries for the whole run, however many flats there are); each is then claimed and sent one by one.
 *  Close: once per month to the collector, from the 1st at 10:00, for the oldest month still open.
 *  Check: from 21:00, once a day per flat, to each person with bazars or bills to check.
 *  CheckLate: from 21:00, once a day per flat, to everyone living here who claimed their name when a bazar or bill has had
 *  no check for 2 days.
 *  ponytail: each due reminder is three round trips (claim, members, subscriptions), about 0.25 s from Singapore; the route
 *  has 25 s, so ~80 due reminders per run. A pilot has a handful of flats; batch the claims if flats ever reach dozens. */
export async function runJobs(db: Db, now: string, send: typeof sendPush = sendPush) {
  const today = now.slice(0, 10), time = now.slice(11);
  const out = { close: 0, check: 0, sent: 0, gone: 0, failed: 0, receipts: 0, purged: 0, checkLate: 0 };
  const add = (r: { sent: number; gone: number; failed: number }) => { out.sent += r.sent; out.gone += r.gone; out.failed += r.failed; };

  if (time >= '10:00') {
    const closes = await db<{ id: string; lang: Locale; month: string; pending: number; collector: string }>(
      `select f.id, f.language as lang, o.month::text as month,
         (select count(*)::int from ledger where flat_id = f.id and month >= o.month and ${blocksClose('o.month', '$2::text::date')}) as pending,
         (select id from members where flat_id = f.id and role = 'manager') as collector
       from flats f join lateral (select min(month) as month from months where flat_id = f.id and status = 'open' and month < $1::date) o on o.month is not null
       where not exists (select 1 from sent_jobs where flat_id = f.id and date = o.month and job_type = 'close')`, [monthOf(today), today]);
    for (const f of closes) {
      if (!await claim(db, f.id, f.month, 'close')) continue;
      out.close++; add(await send(db, [f.collector], closeMsg(f.lang, f.month, f.pending)));
    }
  }

  // Bazars and bills waiting for a check (020): once a day from 21:00, to each person who may check at least one (may_check:
  // the collector; flatmates only for the collector's own spending; nobody who moved out). Nothing waits: no claim, no push.
  if (time >= '21:00') {
    const flats = await db<{ id: string; lang: Locale }>(
      `select f.id, f.language as lang from flats f
       where exists (select 1 from ledger l join months mo on mo.flat_id = l.flat_id and mo.month = l.month and mo.status = 'open'
                     where l.flat_id = f.id and l.type in ('bazar', 'bill') and l.status = 'ok'
                       and not exists (select 1 from entry_checks c where c.ledger_id = l.id))
         and not exists (select 1 from sent_jobs where flat_id = f.id and date = $1::date and job_type = 'check')`, [today]);
    for (const f of flats) {
      const people = await db<{ id: string; lang: Locale | null; n: number }>(
        `select m.id, m.language as lang, count(*)::int as n from members m
           join ledger l on l.flat_id = m.flat_id and l.type in ('bazar', 'bill') and l.status = 'ok'
           join months mo on mo.flat_id = l.flat_id and mo.month = l.month and mo.status = 'open'
         where m.flat_id = $1 and not exists (select 1 from entry_checks c where c.ledger_id = l.id) and may_check(l.id, m.id, $2::text::date)
         group by m.id, m.language`, [f.id, today]);
      if (!people.length || !await claim(db, f.id, today, 'check')) continue;   // nobody may check today: tried again next run
      out.check++;
      for (const p of people) add(await send(db, [p.id], checkMsg(p.lang ?? f.lang, p.n)));
    }
  }

  // Late checks (trust feature 2): a bazar or bill of an open month with no check at all 2 days after it was added (database
  // clock): once a day from 21:00 to everyone living here who claimed their name, checkers included, so the whole flat
  // sees the checks are late.
  if (time >= '21:00') {
    const LATE = `l.type in ('bazar', 'bill') and l.status = 'ok' and l.created_at < now() - interval '2 days'
      and not exists (select 1 from entry_checks c where c.ledger_id = l.id)`;
    const flats = await db<{ id: string; lang: Locale; n: number }>(
      `select f.id, f.language as lang, count(*)::int as n from flats f
         join ledger l on l.flat_id = f.id join months mo on mo.flat_id = l.flat_id and mo.month = l.month and mo.status = 'open'
       where ${LATE} and not exists (select 1 from sent_jobs where flat_id = f.id and date = $1::date and job_type = 'checkLate')
       group by f.id, f.language`, [today]);
    for (const f of flats) {
      const people = await db<{ id: string; lang: Locale | null }>(
        `select id, language as lang from members where flat_id = $1 and pin_hash is not null
           and joined_on <= $2::text::date and (left_on is null or left_on >= $2::text::date)`, [f.id, today]);
      if (!people.length || !await claim(db, f.id, today, 'checkLate')) continue;
      out.checkLate++;
      for (const p of people) add(await send(db, [p.id], lateMsg(p.lang ?? f.lang, f.n)));
    }
  }

  // Receipt photos go 90 days after their month closed (the privacy page says 3 months). A removed entry's receipt and check
  // go once its month is closed: it can't be put back any more. The entry, its item lines and its check state stay.
  out.receipts = (await db(
    `with gone as (delete from receipts r using months mo where mo.flat_id = r.flat_id and mo.month = r.month and mo.status = 'closed'
         and (mo.closed_at < now() - interval '90 days' or not exists (select 1 from ledger l where l.id = r.ledger_id)) returning 1),
       checks as (delete from entry_checks c using months mo where mo.flat_id = c.flat_id and mo.month = c.month and mo.status = 'closed'
         and not exists (select 1 from ledger l where l.id = c.ledger_id))
     select 1 from gone`)).length;

  // the privacy page promises an IP in a rate-limit count is kept about 2 hours, even when no visitor triggers allow()'s sweep
  await db(SWEEP);
  // a recovery step lives 15 minutes at most; the row stays a day only to count codes per email
  await db(`delete from recoveries where created_at < now() - interval '1 day'`);

  // A trial nobody came back to: a month old, at most one person claimed a PIN, never a money entry or a meal change, nothing
  // in the history for 30 days. One statement on the database clock (the columns are timestamptz; `now` here is a Dhaka string
  // for the reminder windows); the flat's rows cascade. ponytail: correlated subqueries over every flat each run, fine for hundreds.
  out.purged = (await db(
    `delete from flats f where created_at < now() - interval '30 days'
       and (select count(*) from members where flat_id = f.id and pin_hash is not null) <= 1
       and not exists (select 1 from ledger where flat_id = f.id)
       and not exists (select 1 from meal_changes where flat_id = f.id)
       and not exists (select 1 from audit_log where flat_id = f.id and at > now() - interval '30 days')
     returning 1`)).length;   // a count: the response goes to cron-job.org, a flat's name stays here
  return out;
}

/** `Authorization: Bearer <CRON_SECRET>`, compared in constant time. No secret configured: nobody gets in. */
export function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
