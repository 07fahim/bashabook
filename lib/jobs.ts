import { timingSafeEqual } from 'node:crypto';
import type { Locale } from '../app/[lang]/dictionaries';
import { blocksClose } from './bazar';
import type { Db } from './db';
import { addDays } from './meals';
import { monthOf } from './money-db';
import { checkMsg, closeMsg, mealMsg } from './notify-text';
import { sendPush } from './push';

/** Claims one logical reminder: true for the first caller only (the primary key is the lock). */
const claim = async (db: Db, flatId: string, date: string, job: string) =>
  (await db(`insert into sent_jobs (flat_id, date, job_type) values ($1, $2, $3) on conflict do nothing returning 1`, [flatId, date, job])).length > 0;

/** Every 5 minutes from cron-job.org. `now` is Dhaka 'YYYY-MM-DDTHH:MM'. Postgres picks the flats with something due (two
 *  queries for the whole run, however many flats there are); each is then claimed and sent one by one.
 *  Meal: in the hour before the flat's cutoff, to everyone in the flat's meals who still lives there tomorrow (nobody is ever
 *  "unset": they eat their usual meals unless they change them), skipped when nothing is cooked tomorrow. Cutoffs start at
 *  01:00 (settingsAction), so the window never wraps midnight. Close: once per month to the collector, from the
 *  1st at 10:00, for the oldest month still open.
 *  Check: from 21:00, once a day per flat, to each person with bazars or bills to check.
 *  ponytail: each due reminder is three round trips (claim, members, subscriptions), about 0.25 s from Singapore; the route
 *  has 25 s, so ~80 due reminders per run. A pilot has a handful of flats; batch the claims if flats ever reach dozens. */
export async function runJobs(db: Db, now: string, send: typeof sendPush = sendPush) {
  const today = now.slice(0, 10), tomorrow = addDays(today, 1), time = now.slice(11);
  const out = { meal: 0, close: 0, check: 0, sent: 0, gone: 0, failed: 0, receipts: 0, purged: [] as string[] };
  const add = (r: { sent: number; gone: number; failed: number }) => { out.sent += r.sent; out.gone += r.gone; out.failed += r.failed; };

  const meals = await db<{ id: string; cutoff: string; lang: Locale }>(
    `select id, cutoff_time::text as cutoff, language as lang from flats
     where $1::time >= cutoff_time - interval '60 minutes' and $1::time < cutoff_time
       and (select count(*) from no_cook where flat_id = flats.id and date = $2::date) < 3
       and not exists (select 1 from sent_jobs where flat_id = flats.id and date = $2::date and job_type = 'meal')`, [time, tomorrow]);
  for (const f of meals) {
    if (!await claim(db, f.id, tomorrow, 'meal')) continue;
    const ids = (await db<{ id: string }>(`select id from members where flat_id = $1 and in_meals and (left_on is null or left_on > $2::date)`, [f.id, today])).map(m => m.id);
    out.meal++; add(await send(db, ids, { ...mealMsg(f.lang, f.cutoff), ttl: 3600 }));   // after the lock the reminder is noise
  }

  if (time >= '10:00') {
    const closes = await db<{ id: string; lang: Locale; month: string; pending: number; collector: string }>(
      `select f.id, f.language as lang, o.month::text as month,
         (select count(*)::int from ledger where flat_id = f.id and month >= o.month and ${blocksClose('o.month')}) as pending,
         (select id from members where flat_id = f.id and role = 'manager') as collector
       from flats f join lateral (select min(month) as month from months where flat_id = f.id and status = 'open' and month < $1::date) o on o.month is not null
       where not exists (select 1 from sent_jobs where flat_id = f.id and date = o.month and job_type = 'close')`, [monthOf(today)]);
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

  // Receipt photos go 90 days after their month closed (the privacy page says 3 months). A removed entry's receipt and check
  // go once its month is closed: it can't be put back any more. The entry, its item lines and its check state stay.
  out.receipts = (await db(
    `with gone as (delete from receipts r using months mo where mo.flat_id = r.flat_id and mo.month = r.month and mo.status = 'closed'
         and (mo.closed_at < now() - interval '90 days' or not exists (select 1 from ledger l where l.id = r.ledger_id)) returning 1),
       checks as (delete from entry_checks c using months mo where mo.flat_id = c.flat_id and mo.month = c.month and mo.status = 'closed'
         and not exists (select 1 from ledger l where l.id = c.ledger_id))
     select 1 from gone`)).length;

  // the privacy page promises an IP in a rate-limit count is kept about 2 hours, even when no visitor triggers allow()'s sweep
  await db(`delete from rate_limits where hour < now() - interval '2 hours'`);

  // A trial nobody came back to: a month old, at most one person claimed a PIN, never a money entry or a meal change, nothing
  // in the history for 30 days. One statement on the database clock (the columns are timestamptz; `now` here is a Dhaka string
  // for the reminder windows); the flat's rows cascade. ponytail: correlated subqueries over every flat each run, fine for hundreds.
  out.purged = (await db<{ name: string }>(
    `delete from flats f where created_at < now() - interval '30 days'
       and (select count(*) from members where flat_id = f.id and pin_hash is not null) <= 1
       and not exists (select 1 from ledger where flat_id = f.id)
       and not exists (select 1 from meal_changes where flat_id = f.id)
       and not exists (select 1 from audit_log where flat_id = f.id and at > now() - interval '30 days')
     returning name`)).map(r => r.name);
  return out;
}

/** `Authorization: Bearer <CRON_SECRET>`, compared in constant time. No secret configured: nobody gets in. */
export function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
