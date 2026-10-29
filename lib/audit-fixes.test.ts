import { describe, it, expect } from 'vitest';
import { checkAll, db, migrate } from '../db/test-db';
import { cleanName, createFlat } from './auth';
import { addCorrection, closableMonth, closeMonth, coverGap } from './close';
import { isDate } from './meals';
import { addGuests } from './meals-db';
import { addEntry, loadMonth, openMonth, type NewEntry } from './money-db';
import { savePush } from './push-db';

// The 2026-10-12 backend audit: each test failed before its fix.
const SEP = '2026-09-01', OCT = '2026-10-01', NOV = '2026-11-01', noCash = { cash: 0, bkash: 0, nagad: 0, bank: 0 };
async function flat(open = [SEP, OCT]) {
  await migrate();
  const f = await createFlat(db, { flatName: 'A', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: SEP, lang: 'en' });
  const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and name = 'Tahsin'`, [f.flatId]);
  for (const m of open) await openMonth(db, f.flatId, m);
  return { ...f, tahsin: t.id, boss: { memberId: f.memberId, role: 'manager' as const } };
}
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

describe('audit fixes', { timeout: 60000 }, () => {
  it('a month nobody opened still gets its monthly bills and its turn to close', async () => {
    const f = await flat([SEP]);
    expect(await addEntry(db, f.flatId, f.boss, e({ type: 'bill', amount: 1000000, note: 'Rent', paidBy: f.memberId, split: 'equal', repeat: true }), '2026-09-05')).toBe('ok');
    await checkAll(f.flatId);
    expect((await closeMonth(db, f.flatId, f.boss, SEP, '2026-10-02', noCash)).result).toBe('ok');
    await openMonth(db, f.flatId, NOV);   // nobody touched the app in October
    expect((await db<{ m: string }>(`select month::text as m from months where flat_id = $1 order by month`, [f.flatId])).map(x => x.m)).toEqual([SEP, OCT, NOV]);
    expect((await db<{ m: string }>(`select month::text as m from ledger where flat_id = $1 and note = 'Rent' order by month`, [f.flatId])).map(x => x.m)).toEqual([SEP, OCT, NOV]);
    expect(await closableMonth(db, f.flatId, '2026-12-02')).toBe(OCT);
  });

  it('a collector who joined after the month can still cover its gap', async () => {
    const f = await flat();
    expect(await addEntry(db, f.flatId, f.boss, e({ type: 'bazar', amount: 100000 }), '2026-09-05')).toBe('ok');
    const [z] = await db<{ id: string }>(`insert into members (flat_id, name, role, joined_on) values ($1, 'Zarif', 'member', '2026-10-05') returning id`, [f.flatId]);
    await db(`update members set role = 'member' where id = $1`, [f.memberId]);
    await db(`update members set role = 'manager' where id = $1`, [z.id]);
    expect(await coverGap(db, f.flatId, { memberId: z.id, role: 'manager' }, '2026-10-10', 'gap', 100000)).toBe('ok');
  });

  it('a resubmitted guest form with the same key adds the guests once', async () => {
    const f = await flat();
    const key = '11111111-1111-4111-8111-111111111111', now = '2026-10-09T12:00';
    expect(await addGuests(db, f.flatId, f.tahsin, '2026-10-20', 'l', 2, now, key)).toBe('open');
    expect(await addGuests(db, f.flatId, f.tahsin, '2026-10-20', 'l', 2, now, key)).toBe('open');
    const [row] = await db<{ guests: number }>(`select guests from meal_changes where member_id = $1 and date = '2026-10-20' and meal = 'l'`, [f.tahsin]);
    expect(row.guests).toBe(2);
    // a refused write gives the key back, so the next try with the same form is not swallowed
    const key2 = '22222222-2222-4222-8222-222222222222', key3 = '33333333-3333-4333-8333-333333333333';
    expect(await addGuests(db, f.flatId, f.tahsin, '2026-10-21', 'l', 9, now, key2)).toBe('open');
    expect(await addGuests(db, f.flatId, f.tahsin, '2026-10-21', 'l', 1, now, key3)).toBe('full');
    expect(await addGuests(db, f.flatId, f.tahsin, '2026-10-22', 'l', 1, now, key3)).toBe('open');
  });

  it('one person keeps at most five push subscriptions', async () => {
    const f = await flat();
    for (let i = 0; i < 8; i++) await savePush(db, f.flatId, f.tahsin, { endpoint: `https://fcm.googleapis.com/fcm/send/x${i}`, keys: { p256dh: 'A'.repeat(80), auth: 'B'.repeat(22) } });
    await savePush(db, f.flatId, f.tahsin, { endpoint: 'https://fcm.googleapis.com/fcm/send/x0', keys: { p256dh: 'C'.repeat(80), auth: 'B'.repeat(22) } });   // the same browser again: updated, not counted twice
    const rows = await db<{ p: string }>(`select p256dh as p from push_subs where member_id = $1 order by endpoint`, [f.tahsin]);
    expect(rows.length).toBe(5);
    expect(rows[0].p).toBe('C'.repeat(80));
  });

  it('a closed month with a balance past 2^31 poisha still loads', async () => {
    const f = await flat();
    await db(`update months set status = 'closed', closed_at = now(), version = version + 1 where flat_id = $1 and month = $2`, [f.flatId, SEP]);
    await db(`insert into month_balances (flat_id, month, member_id, weighted_meals, days_present, opening, paid_in, food_cost, bill_share, payouts, adjustments, balance)
              values ($1, $2, $3, 0, 30, 0, 3000000000, 0, 0, 0, 0, 3000000000)`, [f.flatId, SEP, f.tahsin]);
    const mo = await loadMonth(db, f.flatId, OCT, '2026-10-09');
    expect(mo.result.perMember.find(m => m.id === f.tahsin)?.opening).toBe(3000000000);
  });

  it('someone a correction charges can settle up in the month it is booked', async () => {
    const f = await flat();
    await db(`update members set left_on = '2026-09-30' where id = $1`, [f.tahsin]);
    expect(await addEntry(db, f.flatId, f.boss, e({ type: 'bazar', amount: 20000, paidBy: f.memberId }), '2026-09-05')).toBe('ok');
    await checkAll(f.flatId);
    expect((await closeMonth(db, f.flatId, f.boss, SEP, '2026-10-02', noCash)).result).toBe('ok');
    expect((await closeMonth(db, f.flatId, f.boss, OCT, '2026-11-02', noCash)).result).toBe('ok');
    await openMonth(db, f.flatId, NOV);
    expect(await addCorrection(db, f.flatId, f.boss, { id: '33333333-3333-4333-8333-333333333333', kind: 'bazar', forMonth: SEP, amount: 10000, note: 'forgot', paidBy: f.memberId } as never, '2026-11-02')).toBe('ok');
    expect(await addEntry(db, f.flatId, f.boss, e({ type: 'deposit', amount: 5000, memberId: f.tahsin, date: '2026-11-03' }), '2026-11-03')).toBe('ok');
  });

  it('dates before 2000 and hidden characters in names are refused or stripped', () => {
    expect(isDate('0000-01-01')).toBe(false);
    expect(isDate('2026-10-12')).toBe(true);
    expect(cleanName('Na‮fis\n ')).toBe('Nafis');
    expect(cleanName('ক্‍ষ‌')).toBe('ক্‍ষ‌');   // Bangla joiners stay
  });
});
