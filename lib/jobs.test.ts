import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkAll, db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { closeMonth } from './close';
import { authorized, runJobs } from './jobs';
import { addEntry, openMonth, removeEntry } from './money-db';
import type { Msg } from './push';

const spy = () => {
  const calls: { ids: string[]; msg: Msg }[] = [];
  const send = async (_db: unknown, ids: string[], msg: Msg) => { calls.push({ ids, msg }); return { sent: ids.length, gone: 0, failed: 0 }; };
  return { calls, send: send as never };
};

const claimed = async (flatId: string, date: string) =>
  (await db(`select 1 from sent_jobs where flat_id = $1 and date = $2::date and job_type = 'check'`, [flatId, date])).length > 0;

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
    expect(w.msg.title).toBe('September: 1 still to confirm or check');
  });

  it('close: a bazar not Verified counts as still waiting', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J7', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'en' });
    const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
    await openMonth(db, f.flatId, '2026-09-01');
    expect(await addEntry(db, f.flatId, { memberId: t.id, role: 'member' }, { type: 'bazar', amount: 50000, date: '2026-09-10', note: null, paidBy: t.id, memberId: null, split: null, selected: [] }, '2026-09-10')).toBe('ok');
    const s = spy();
    await runJobs(db, '2026-10-01T10:00', s.send);
    expect(s.calls.filter(c => c.ids.includes(f.memberId)).map(c => c.msg.title)).toEqual(['September: 1 still to confirm or check']);
  });

  it('authorized: bearer secret only, timing-safe, no secret configured means nobody', () => {
    expect(authorized('Bearer abc', 'abc')).toBe(true);
    expect(authorized('Bearer abd', 'abc')).toBe(false);
    expect(authorized('Bearer ab', 'abc')).toBe(false);
    expect(authorized(null, 'abc')).toBe(false);
    expect(authorized('Bearer ', '')).toBe(false);
    expect(authorized('Bearer abc', undefined)).toBe(false);
  });

  it('check: from 21:00 once a day, to each person who may check something, never for their own spending', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J5', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif', 'Rafi'], today: '2026-10-01', lang: 'en' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    await db(`update members set pin_hash = 'x' where flat_id = $1 and pin_hash is null`, [f.flatId]);   // everyone claimed their name
    await db(`update members set left_on = '2026-10-03' where id = $1`, [ids.Rafi]);   // moved out: gets nothing
    await openMonth(db, f.flatId, '2026-10-01');
    // this flat's check pushes only: other tests' flats share the database
    const s = spy(), checks = () => s.calls.filter(c => /check/.test(c.msg.title) && Object.values(ids).includes(c.ids[0]));
    await runJobs(db, '2026-10-05T21:00', s.send);
    expect(await claimed(f.flatId, '2026-10-05')).toBe(false);   // nothing waits: no claim
    const add = (by: string, role: 'member' | 'manager', paidBy: string | null) => addEntry(db, f.flatId, { memberId: by, role },
      { type: 'bazar', amount: 50000, date: '2026-10-05', note: null, paidBy, memberId: null, split: null, selected: [] }, '2026-10-05');
    expect(await add(ids.Tahsin, 'member', ids.Tahsin)).toBe('ok');   // the collector checks it
    expect(await add(ids.Nafis, 'manager', null)).toBe('ok');         // flat money twice: the others check them
    expect(await add(ids.Nafis, 'manager', null)).toBe('ok');
    await runJobs(db, '2026-10-05T20:59', s.send);
    expect(checks()).toEqual([]);
    await runJobs(db, '2026-10-05T21:00', s.send);
    await runJobs(db, '2026-10-05T21:30', s.send);   // once a day
    expect(checks()).toHaveLength(3);
    expect(Object.fromEntries(checks().map(c => [c.ids[0], c.msg.title]))).toEqual({
      [ids.Nafis]: '1 bazar or bill waits for your check',
      [ids.Tahsin]: '2 bazars and bills wait for your check',
      [ids.Zarif]: '2 bazars and bills wait for your check',
    });
    expect(checks().every(c => c.ids.length === 1 && c.msg.url === '/en/money')).toBe(true);
    await checkAll(f.flatId);
    await runJobs(db, '2026-10-06T21:00', s.send);
    expect(checks()).toHaveLength(3);
    expect(await claimed(f.flatId, '2026-10-06')).toBe(false);
  });

  it('check: a bazar nobody may check today (its only checker moved out): no claim, no count', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J8', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-01', lang: 'en' });
    const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
    await openMonth(db, f.flatId, '2026-10-01');
    expect(await addEntry(db, f.flatId, { memberId: t.id, role: 'member' }, { type: 'bazar', amount: 50000, date: '2026-10-03', note: null, paidBy: t.id, memberId: null, split: null, selected: [] }, '2026-10-03')).toBe('ok');
    await db(`update members set left_on = '2026-10-04' where id = $1`, [f.memberId]);   // only the collector may check Tahsin's own
    const s = spy();
    await runJobs(db, '2026-10-05T21:00', s.send);
    expect(await claimed(f.flatId, '2026-10-05')).toBe(false);   // claim and count go together: neither
    expect(s.calls.filter(c => /check/.test(c.msg.title) && [f.memberId, t.id].includes(c.ids[0]))).toEqual([]);
  });

  it('purge: a receipt 90 days after its month closed; a removed entry’s receipt and check once its month closed', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'J6', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'en' });
    const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
    const nafis = { memberId: f.memberId, role: 'manager' as const };
    await openMonth(db, f.flatId, '2026-09-01'); await openMonth(db, f.flatId, '2026-10-01');
    const add = async (date: string) => {
      const id = randomUUID();
      expect(await addEntry(db, f.flatId, nafis, { id, type: 'bazar', amount: 1000, date, note: null, paidBy: t.id, memberId: null, split: null, selected: [],
        items: [{ name: 'Rice', amount: null }], receipt: Uint8Array.from([0xff, 0xd8, 0xff, 1]) })).toBe('ok');
      return id;
    };
    const kept = await add('2026-09-05'), gone = await add('2026-09-06'), oct = await add('2026-10-05');
    await checkAll(f.flatId);
    expect(await removeEntry(db, f.flatId, nafis, gone, '2026-10-09')).toBe(true);
    const receipts = async () => (await db<{ id: string }>(`select ledger_id as id from receipts where flat_id = $1`, [f.flatId])).map(r => r.id).sort();
    const s = spy();
    expect((await runJobs(db, '2026-10-09T12:00', s.send)).receipts).toBe(0);   // September open: gone can still be put back
    expect((await closeMonth(db, f.flatId, nafis, '2026-09-01', '2026-10-09', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    expect((await runJobs(db, '2026-10-09T12:05', s.send)).receipts).toBe(1);
    expect(await receipts()).toEqual([kept, oct].sort());
    expect(await db(`select 1 from entry_checks where ledger_id = $1`, [gone])).toHaveLength(0);
    await db(`update months set closed_at = now() - interval '91 days' where flat_id = $1 and month = '2026-09-01'::text::date`, [f.flatId]);
    expect((await runJobs(db, '2026-10-09T12:10', s.send)).receipts).toBe(1);
    expect(await receipts()).toEqual([oct]);
    for (const table of ['ledger', 'bazar_items', 'entry_checks']) {   // the entry, its lines and its check stay
      expect(await db(`select 1 from ${table} where ${table === 'ledger' ? 'id' : 'ledger_id'} = $1`, [kept]), table).toHaveLength(1);
    }
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
    expect(r.purged).toBe(1);
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
