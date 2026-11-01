import type { Db } from './db';

/** Old counts to delete: an hour row after two hours (it can hold an IP; the privacy page says about 2 hours), a day row
 *  ('day:' keys, never an IP) two days after its day began, so it counts its whole day. Shared with the cron's sweep (lib/jobs). */
export const SWEEP = `delete from rate_limits where (hour < now() - interval '2 hours' and key not like 'day:%') or hour < now() - interval '2 days'`;

/** Counts one more try of `key` in the current hour (or day: its key must start 'day:' so the sweep keeps it all day);
 *  false once past `limit`. One statement, so parallel tries can't slip past; the same statement sweeps old rows. A day is
 *  Dhaka's, so "try again tomorrow" means after midnight there. */
export async function allow(db: Db, key: string, limit: number, per: 'hour' | 'day' = 'hour') {
  const [{ n }] = await db<{ n: number }>(
    `with sweep as (${SWEEP})
     insert into rate_limits (key, hour) values ($1, date_trunc('${per}', now(), 'Asia/Dhaka'))
     on conflict (key, hour) do update set n = rate_limits.n + 1 returning n`, [key]);
  return n <= limit;
}

/** The client address from x-forwarded-for (Vercel sets it; the first entry is the client). */
export const firstIp = (header: string | null) => header?.split(',')[0].trim() || 'unknown';
