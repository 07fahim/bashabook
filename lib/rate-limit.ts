import type { Db } from './db';

/** Counts one more try of `key` (an action and a connection) in the current hour; false once past `limit`. One statement,
 *  so parallel tries can't slip past; the same statement sweeps rows older than two hours. */
export async function allow(db: Db, key: string, limit: number) {
  const [{ n }] = await db<{ n: number }>(
    `with sweep as (delete from rate_limits where hour < now() - interval '2 hours')
     insert into rate_limits (key, hour) values ($1, date_trunc('hour', now()))
     on conflict (key, hour) do update set n = rate_limits.n + 1 returning n`, [key]);
  return n <= limit;
}

/** The client address from x-forwarded-for (Vercel sets it; the first entry is the client). */
export const firstIp = (header: string | null) => header?.split(',')[0].trim() || 'unknown';
