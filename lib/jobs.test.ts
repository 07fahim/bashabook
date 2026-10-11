import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { authorized, runJobs } from './jobs';
import { addEntry, openMonth } from './money-db';
import type { Msg } from './push';

const spy = () => {
  const calls: { ids: string[]; msg: Msg }[] = [];
  const send = async (_db: unknown, ids: string[], msg: Msg) => { calls.push({ ids, msg }); return { sent: ids.length, gone: 0, failed: 0 }; };
  return { calls, send: send as never };
};

describe('timed reminders', { timeout: 30000 }, () => {
  it('meal: once per flat in the hour before its cutoff, to everyone, not on a no-cook day', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J1', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-05', lang: 'bn' });
    const s = spy();
    expect((await runJobs(db, '2026-10-05T20:59', s.send)).meal).toBe(0);
    expect((await runJobs(db, '2026-10-05T21:00', s.send)).meal).toBe(1);
    expect((await runJobs(db, '2026-10-05T21:05', s.send)).meal).toBe(0);   // claimed already
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].ids.length).toBe(2);
    expect(s.calls[0].msg.title).toContain('10:00 pm');
    expect(s.calls[0].msg.url).toBe('/bn/meals');
    // another cutoff moves the window
    await db(`update flats set cutoff_time = '19:30' where id = $1`, [f.flatId]);
    expect((await runJobs(db, '2026-10-06T18:29', s.send)).meal).toBe(0);
    expect((await runJobs(db, '2026-10-06T18:30', s.send)).meal).toBe(1);
    // nothing cooked tomorrow: no reminder
    await db(`insert into no_cook (flat_id, date, meal) values ($1, '2026-10-08', 'b'), ($1, '2026-10-08', 'l'), ($1, '2026-10-08', 'd')`, [f.flatId]);
    expect((await runJobs(db, '2026-10-07T19:00', s.send)).meal).toBe(0);
    await db(`delete from no_cook where flat_id = $1 and meal = 'd'`, [f.flatId]);
    expect((await runJobs(db, '2026-10-07T19:01', s.send)).meal).toBe(1);
  });

  it('close: once per month to the collector from the 1st at 10:00, and says how many confirmations are missing', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J2', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'en' });
    await openMonth(db, f.flatId, '2026-09-01');
    const s = spy();
    expect((await runJobs(db, '2026-09-30T12:00', s.send)).close).toBe(0);   // month not over
    expect((await runJobs(db, '2026-10-01T09:59', s.send)).close).toBe(0);   // too early in the day
    expect((await runJobs(db, '2026-10-01T10:00', s.send)).close).toBe(1);
    expect((await runJobs(db, '2026-10-01T10:05', s.send)).close).toBe(0);
    const c = s.calls.find(c => c.msg.url === '/en/manage')!;
    expect(c.ids).toEqual([f.memberId]);
    expect(c.msg.title).toBe('September is ready to close');
    // a second flat with a pending deposit gets the waiting text
    const g = await createFlat(db, { flatName: 'J3', name: 'Zarif', pin: '1234', others: ['Rafi'], today: '2026-09-01', lang: 'en' });
    const [r] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [g.flatId]);
    await openMonth(db, g.flatId, '2026-09-01');
    expect(await addEntry(db, g.flatId, { memberId: r.id, role: 'member' }, { type: 'deposit', amount: 50000, date: '2026-09-10', note: null, paidBy: null, memberId: r.id, split: null, selected: [] }, '2026-09-10')).toBe('ok');
    expect((await runJobs(db, '2026-10-01T10:10', s.send)).close).toBe(1);
    const w = s.calls.find(c => c.msg.url === '/en/money')!;
    expect(w.ids).toEqual([g.memberId]);
    expect(w.msg.title).toBe('September is waiting on 1 confirmations');
  });

  it('authorized: bearer secret only, timing-safe, no secret configured means nobody', () => {
    expect(authorized('Bearer abc', 'abc')).toBe(true);
    expect(authorized('Bearer abd', 'abc')).toBe(false);
    expect(authorized('Bearer ab', 'abc')).toBe(false);
    expect(authorized(null, 'abc')).toBe(false);
    expect(authorized('Bearer ', '')).toBe(false);
    expect(authorized('Bearer abc', undefined)).toBe(false);
  });
});
