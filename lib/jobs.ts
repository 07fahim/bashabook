import { timingSafeEqual } from 'node:crypto';
import type { Locale } from '../app/[lang]/dictionaries';
import { closableMonth } from './close';
import type { Db } from './db';
import { addDays } from './meals';
import { closeMsg, mealMsg } from './notify-text';
import { sendPush } from './push';

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Claims one logical reminder: true for the first caller only (the primary key is the lock). */
const claim = async (db: Db, flatId: string, date: string, job: string) =>
  (await db(`insert into sent_jobs (flat_id, date, job_type) values ($1, $2, $3) on conflict do nothing returning 1`, [flatId, date, job])).length > 0;

/** Every 5 minutes from cron-job.org. `now` is Dhaka 'YYYY-MM-DDTHH:MM'. Each flat: the meal reminder in the hour before its
 *  cutoff (everyone, since nobody is ever "unset": they eat their usual meals unless they change them), skipped when nothing
 *  is cooked tomorrow; the close reminder once per month to the collector, from the 1st at 10:00. */
export async function runJobs(db: Db, now: string, send: typeof sendPush = sendPush) {
  const today = now.slice(0, 10), tomorrow = addDays(today, 1), nowMin = minutes(now.slice(11));
  const flats = await db<{ id: string; cutoff: string; lang: Locale }>(`select id, cutoff_time::text as cutoff, language as lang from flats`);
  const out = { meal: 0, close: 0, sent: 0, gone: 0, failed: 0 };
  const add = (r: { sent: number; gone: number; failed: number }) => { out.sent += r.sent; out.gone += r.gone; out.failed += r.failed; };
  for (const f of flats) {
    const cut = minutes(f.cutoff);
    if (nowMin >= cut - 60 && nowMin < cut) {
      const [{ n }] = await db<{ n: number }>(`select count(*)::int as n from no_cook where flat_id = $1 and date = $2`, [f.id, tomorrow]);
      if (n < 3 && await claim(db, f.id, tomorrow, 'meal')) {
        const ids = (await db<{ id: string }>(`select id from members where flat_id = $1 and (left_on is null or left_on >= $2::date)`, [f.id, today])).map(m => m.id);
        out.meal++; add(await send(db, ids, mealMsg(f.lang, f.cutoff)));
      }
    }
    if (nowMin >= 10 * 60) {
      const month = await closableMonth(db, f.id, today);
      if (month && await claim(db, f.id, month, 'close')) {
        const [{ n }] = await db<{ n: number }>(`select count(*)::int as n from ledger where flat_id = $1 and status = 'pending' and month >= $2::date`, [f.id, month]);
        const ids = (await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'manager'`, [f.id])).map(m => m.id);
        out.close++; add(await send(db, ids, closeMsg(f.lang, month, n)));
      }
    }
  }
  return out;
}

/** `Authorization: Bearer <CRON_SECRET>`, compared in constant time. No secret configured: nobody gets in. */
export function authorized(header: string | null, secret: string | undefined) {
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7)), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
