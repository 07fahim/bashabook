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
    const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
    expect(s.calls[0].ids.sort()).toEqual([f.memberId, t.id].sort());
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
    // a leaver whose last day is today has no meals tomorrow; someone cooking for themselves has none to lock
    await db(`update members set left_on = '2026-10-08' where id = $1`, [t.id]);
    await db(`update members set in_meals = false where id = $1`, [f.memberId]);
    expect((await runJobs(db, '2026-10-08T19:00', s.send)).meal).toBe(1);
    expect(s.calls.at(-1)!.ids).toEqual([]);
    // two runs at once: the claim, not the filter, keeps it to one
    await db(`update members set in_meals = true, left_on = null where flat_id = $1`, [f.flatId]);
    const both = await Promise.all([runJobs(db, '2026-10-09T19:00', s.send), runJobs(db, '2026-10-09T19:00', s.send)]);
    expect(both[0].meal + both[1].meal).toBe(1);
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
    // a flat with only the current month open has nothing to close
    const h = await createFlat(db, { flatName: 'J4', name: 'Rafi', pin: '1234', others: [], today: '2026-10-01', lang: 'en' });
    await openMonth(db, h.flatId, '2026-10-01');
    expect((await runJobs(db, '2026-10-01T10:06', s.send)).close).toBe(0);
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
    expect(w.msg.title).toBe('September: 1 still to confirm');
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

describe('abandoned flats', { timeout: 30000 }, () => {
  const age = async (flatId: string) => {
    await db(`update flats set created_at = now() - interval '31 days' where id = $1`, [flatId]);
    await db(`update audit_log set at = now() - interval '31 days' where flat_id = $1`, [flatId]);
  };
  const names = async () => (await db<{ name: string }>(`select name from flats where name in ('Trial', 'Two', 'Money', 'Busy', 'Meals', 'Young') order by name`)).map(r => r.name);
  it('a month-old flat with one claimed person, no money and no activity is deleted; others stay', async () => {
    await migrate();
    const s = spy();
    const old = await createFlat(db, { flatName: 'Trial', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'en' });
    const two = await createFlat(db, { flatName: 'Two', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'en' });
    const money = await createFlat(db, { flatName: 'Money', name: 'Nafis', pin: '1234', others: [], today: '2026-09-01', lang: 'en' });
    const busy = await createFlat(db, { flatName: 'Busy', name: 'Nafis', pin: '1234', others: [], today: '2026-09-01', lang: 'en' });
    const meals = await createFlat(db, { flatName: 'Meals', name: 'Nafis', pin: '1234', others: [], today: '2026-09-01', lang: 'en' });
    await createFlat(db, { flatName: 'Young', name: 'Nafis', pin: '1234', others: [], today: '2026-10-01', lang: 'en' });
    await db(`insert into meal_changes (flat_id, member_id, date, meal, count) values ($1, $2, '2026-09-10', 'd', 0)`, [meals.flatId, meals.memberId]);
    for (const f of [old, two, money, busy, meals]) await age(f.flatId);
    await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [two.flatId]);
    await openMonth(db, money.flatId, '2026-09-01');
    await addEntry(db, money.flatId, { memberId: money.memberId, role: 'manager' }, { type: 'bazar', amount: 50000, date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [] });
    await db(`insert into audit_log (flat_id, entity, entity_id, after) values ($1, 'members', 'x', '{}')`, [busy.flatId]);
    const r = await runJobs(db, '2026-10-05T12:00', s.send);
    expect(r.purged).toEqual(['Trial']);
    expect(await names()).toEqual(['Busy', 'Meals', 'Money', 'Two', 'Young']);
  });
});

describe('rate-limit rows', { timeout: 30000 }, () => {
  it('each run deletes counts older than two hours, so an IP is never kept longer even when nobody visits', async () => {
    await migrate();
    await db(`insert into rate_limits (key, hour, n) values ('pin:198.51.100.7', date_trunc('hour', now()) - interval '3 hours', 1), ('pin:198.51.100.8', date_trunc('hour', now()), 1)`);
    await runJobs(db, '2026-10-05T12:00', spy().send);
    expect((await db<{ key: string }>(`select key from rate_limits where key like 'pin:198.51.100.%' order by key`)).map(r => r.key)).toEqual(['pin:198.51.100.8']);
  });
});
