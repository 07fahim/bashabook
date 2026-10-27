import { timingSafeEqual } from 'node:crypto';
import type { Locale } from '../app/[lang]/dictionaries';
import type { Db } from './db';
import { addDays } from './meals';
import { monthOf } from './money-db';
import { closeMsg, mealMsg } from './notify-text';
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
 *  ponytail: each due reminder is three round trips (claim, members, subscriptions), about 0.25 s from Singapore; the route
 *  has 25 s, so ~80 due reminders per run. A pilot has a handful of flats; batch the claims if flats ever reach dozens. */
export async function runJobs(db: Db, now: string, send: typeof sendPush = sendPush) {
  const today = now.slice(0, 10), tomorrow = addDays(today, 1), time = now.slice(11);
  const out = { meal: 0, close: 0, sent: 0, gone: 0, failed: 0, purged: [] as string[] };
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
         (select count(*)::int from ledger where flat_id = f.id and status = 'pending' and month >= o.month) as pending,
         (select id from members where flat_id = f.id and role = 'manager') as collector
       from flats f join lateral (select min(month) as month from months where flat_id = f.id and status = 'open' and month < $1::date) o on o.month is not null
       where not exists (select 1 from sent_jobs where flat_id = f.id and date = o.month and job_type = 'close')`, [monthOf(today)]);
    for (const f of closes) {
      if (!await claim(db, f.id, f.month, 'close')) continue;
      out.close++; add(await send(db, [f.collector], closeMsg(f.lang, f.month, f.pending)));
    }
  }

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
