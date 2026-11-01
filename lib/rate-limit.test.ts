import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { allow, firstIp } from './rate-limit';

describe('per-connection limits on anonymous actions', { timeout: 30000 }, () => {
  it('lets `limit` tries through in an hour and refuses the next; another key is separate', async () => {
    await migrate();
    for (let i = 0; i < 3; i++) expect(await allow(db, 'new:1.2.3.4', 3)).toBe(true);
    expect(await allow(db, 'new:1.2.3.4', 3)).toBe(false);
    expect(await allow(db, 'new:5.6.7.8', 3)).toBe(true);
    expect(await allow(db, 'pin:1.2.3.4', 3)).toBe(true);
  });
  it('sweeps rows older than two hours with the next count', async () => {
    await migrate();
    await db(`insert into rate_limits (key, hour, n) values ('old:1.1.1.1', date_trunc('hour', now()) - interval '3 hours', 9)`);
    await allow(db, 'new:9.9.9.9', 5);
    expect(await db(`select 1 from rate_limits where key = 'old:1.1.1.1'`)).toEqual([]);
  });
  it('a day key counts the whole day: an earlier hour of today still counts', async () => {
    await migrate();
    await db(`insert into rate_limits (key, hour, n) values ('day:test', date_trunc('day', now(), 'Asia/Dhaka'), 2)`);
    expect(await allow(db, 'day:test', 3, 'day')).toBe(true);
    expect(await allow(db, 'day:test', 3, 'day')).toBe(false);
  });
  it('a day is Dhaka’s day even when the database runs in UTC (Supabase does)', async () => {
    await migrate();
    await db(`set TimeZone = 'UTC'`);
    try {
      await allow(db, 'day:dhaka', 3, 'day');
      const [r] = await db<{ ok: boolean }>(`select hour = (date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka') as ok from rate_limits where key = 'day:dhaka'`);
      expect(r.ok).toBe(true);
    } finally { await db(`reset TimeZone`); }
  });
  it('the sweep keeps a day row until its day is over, never an hour row past two hours', async () => {
    await migrate();
    await db(`insert into rate_limits (key, hour, n) values ('day:today', now() - interval '3 hours', 1),
      ('day:old', now() - interval '3 days', 1), ('hr:1.1.1.1', date_trunc('hour', now()) - interval '3 hours', 1)`);
    await allow(db, 'new:9.9.9.9', 5);
    expect((await db<{ key: string }>(`select key from rate_limits where key in ('day:today', 'day:old', 'hr:1.1.1.1')`)).map(r => r.key)).toEqual(['day:today']);
  });
  it('reads the client from the first forwarded address, or unknown', () => {
    expect(firstIp('203.0.113.9, 10.0.0.1')).toBe('203.0.113.9');
    expect(firstIp('203.0.113.9')).toBe('203.0.113.9');
    expect(firstIp(null)).toBe('unknown');
    expect(firstIp('')).toBe('unknown');
  });
});
