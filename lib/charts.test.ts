import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkAll, db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, type Entry, type NewEntry } from './money-db';
import { addCorrection, closeMonth } from './close';
import { billShareIn, costRows, forecast, history, lastMonths, mealGrid, myPlates, pickDay, runningSpend, slices, spendByKind, waterfall, worthALook } from './charts';
import type { MealChange, MealMember } from './meals';

const row = (p: Partial<Entry> & Pick<Entry, 'type' | 'amount'>): Entry =>
  ({ id: 'x', status: 'ok', note: null, paidBy: null, memberId: null, split: null, selected: [], date: '2026-09-05', createdBy: 'c', forMonth: null, moves: null, heldBy: null, ...p } as Entry);

describe('spendByKind', () => {
  it('bazar first, bills by note, biggest first; pending rows and corrections for another month stay out', () => {
    const rows = [row({ type: 'bazar', amount: 100 }), row({ type: 'bazar', amount: 200 }), row({ type: 'deposit', amount: 999 }),
      row({ type: 'bill', amount: 50, note: 'Gas' }), row({ type: 'bill', amount: 400, note: 'Rent' }), row({ type: 'bill', amount: 30, note: 'Gas' }),
      row({ type: 'bill', amount: 5, note: 'Rent', status: 'pending' }), row({ type: 'bazar', amount: 77, forMonth: '2026-08-01' })];
    expect(spendByKind(rows, 'Others')).toEqual([{ label: 'bazar', value: 300 }, { label: 'Rent', value: 400 }, { label: 'Gas', value: 80 }]);
  });
  it('a bill without a note counts under others', () => {
    expect(spendByKind([row({ type: 'bill', amount: 10, note: '  ' }), row({ type: 'bill', amount: 5, note: null })], 'Others')).toEqual([{ label: 'bazar', value: 0 }, { label: 'Others', value: 15 }]);
  });
  it('caps bills at 8 rows and sums the rest as others', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ type: 'bill', amount: 100 - i, note: `B${i}` }));
    const out = spendByKind(rows, 'Others');
    expect(out).toHaveLength(10);   // bazar 0, 8 bills, others
    expect(out[0]).toEqual({ label: 'bazar', value: 0 });
    expect(out.at(-1)).toEqual({ label: 'Others', value: 92 + 91 });
  });
});

describe('costRows', () => {
  it('sorts by food plus bills and drops empty rows', () => {
    const p = (id: string, foodCost: number, billShare: number) => ({ id, opening: 0, paidIn: 0, foodCost, billShare, payouts: 0, adjustments: 0, balance: 0 });
    expect(costRows([p('a', 10, 5), p('b', 0, 0), p('c', 20, 0)])).toEqual([{ id: 'c', food: 20, bills: 0 }, { id: 'a', food: 10, bills: 5 }]);
  });
});

describe('lastMonths', { timeout: 30000 }, () => {
  it('closed months only, oldest first, limited, with rate and spend; a later correction stays out of its month', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-07-01', lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    const e = (date: string, p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry => ({ date, note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
    const month = async (m: string, bazar: number) => {
      expect(await addEntry(db, f.flatId, nafis, e(`${m}-05`, { type: 'deposit', amount: bazar + 10000, memberId: ids.Tahsin }))).toBe('ok');
      expect(await addEntry(db, f.flatId, nafis, e(`${m}-05`, { type: 'bazar', amount: bazar }))).toBe('ok');
      expect(await addEntry(db, f.flatId, nafis, e(`${m}-05`, { type: 'bill', amount: 10000, note: 'Gas', split: 'equal' }))).toBe('ok');
    };
    await month('2026-07', 20000);
    expect(await lastMonths(db, f.flatId, '2026-10-01')).toEqual([]);   // still open
    await checkAll(f.flatId);
    expect((await closeMonth(db, f.flatId, nafis, '2026-07-01', '2026-08-02', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    await month('2026-08', 30000);
    await checkAll(f.flatId);
    expect((await closeMonth(db, f.flatId, nafis, '2026-08-01', '2026-09-02', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    // September books a bazar Tahsin paid for August: August's own spend must not move
    expect(await addCorrection(db, f.flatId, nafis, { id: randomUUID(), kind: 'bazar', forMonth: '2026-08-01', amount: 5000, paidBy: ids.Tahsin, note: 'egg receipt' }, '2026-09-03')).toBe('ok');
    const out = await lastMonths(db, f.flatId, '2026-10-01');
    expect(out.map(m => [m.month, m.spend])).toEqual([['2026-07-01', 30000], ['2026-08-01', 40000]]);
    expect(out.every(m => m.rate > 0)).toBe(true);
    expect((await lastMonths(db, f.flatId, '2026-10-01', 1)).map(m => m.month)).toEqual(['2026-08-01']);   // the newest n
    expect(await lastMonths(db, f.flatId, '2026-07-01')).toEqual([]);   // only months before the one asked
    expect(await billShareIn(db, f.flatId, ids.Tahsin, '2026-08-01')).toBe(5000);   // the gas bill, split equally between two
    expect(await billShareIn(db, f.flatId, ids.Tahsin, '2026-09-01')).toBeNull();   // not closed, no snapshot
    // history: the closed months' saved bazar and bills only; the September correction for August stays out, September itself is open
    expect((await history(db, f.flatId, '2026-10-01')).map(r => [r.month, r.type, r.amount, r.note]))
      .toEqual([['2026-07-01', 'bazar', 20000, null], ['2026-07-01', 'bill', 10000, 'Gas'], ['2026-08-01', 'bazar', 30000, null], ['2026-08-01', 'bill', 10000, 'Gas']]);
    expect((await history(db, f.flatId, '2026-10-01', 1)).map(r => r.month)).toEqual(['2026-08-01', '2026-08-01']);   // the newest n closed months
  });
});

describe('worthALook', () => {
  const past = (month: string, p: Partial<{ type: 'bazar' | 'bill'; amount: number; day: string; note: string | null }> = {}) =>
    ({ month, type: p.type ?? 'bazar', amount: p.amount ?? 1000, date: `${month.slice(0, 8)}${p.day ?? '05'}`, note: p.note ?? null });
  it('the same saved entry twice on one day; not two people paying the same, nor two monthly bills of one amount', () => {
    const rows = [row({ type: 'bazar', amount: 500, date: '2026-10-03' }), row({ type: 'bazar', amount: 500, date: '2026-10-03' }), row({ type: 'bazar', amount: 500, date: '2026-10-04' }),
      row({ type: 'bazar', amount: 500, date: '2026-10-03', paidBy: 'p' }),
      row({ type: 'bill', amount: 50000, date: '2026-10-01', note: 'Wi-Fi' }), row({ type: 'bill', amount: 50000, date: '2026-10-01', note: 'Gas' }),
      row({ type: 'bill', amount: 70000, date: '2026-10-03', note: 'Gas' }), row({ type: 'bill', amount: 70000, date: '2026-10-03', note: 'gas ' }), row({ type: 'bill', amount: 70000, date: '2026-10-03', note: 'gas', forMonth: '2026-09-01' })];
    expect(worthALook(rows, [], '2026-10-15')).toEqual([
      { kind: 'dup', type: 'bazar', date: '2026-10-03', amount: 500, note: null, n: 2 },
      { kind: 'dup', type: 'bill', date: '2026-10-03', amount: 70000, note: 'gas', n: 2 }]);
  });
  it('a bazar above every closed-month bazar, only once ten of them exist', () => {
    const nine = Array.from({ length: 9 }, () => past('2026-09-01', { amount: 2000 }));
    const rows = [row({ type: 'bazar', amount: 2500, date: '2026-10-03' })];
    expect(worthALook(rows, nine, '2026-10-15')).toEqual([]);
    expect(worthALook(rows, [...nine, past('2026-08-01', { amount: 2400 })], '2026-10-15')).toEqual([{ kind: 'high', date: '2026-10-03', amount: 2500, max: 2400 }]);
    expect(worthALook([row({ type: 'bazar', amount: 2400, date: '2026-10-03' })], [...nine, past('2026-08-01', { amount: 2400 })], '2026-10-15')).toEqual([]);   // equal is not above
  });
  it('a bill note in by a day in each of the last three closed months, not in yet after that day', () => {
    const hist = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].flatMap(m => [past(m, { type: 'bill', note: 'Wi-Fi ', day: m === '2026-08-01' ? '12' : '07' }), past(m, { type: 'bill', note: 'Gas', day: '10' })]);
    hist.push(past('2026-09-01', { type: 'bill', note: 'Cook pay', day: '28' }));   // one month only: not a habit yet
    const here = [row({ type: 'bill', amount: 900, note: 'gas', date: '2026-10-02' })];   // Gas is in (note matched loosely)
    expect(worthALook(here, hist, '2026-10-12')).toEqual([]);                                // the 12th: Wi-Fi's latest day, not past it
    expect(worthALook(here, hist, '2026-10-12', true)).toEqual([{ kind: 'missing', note: 'Wi-Fi', day: 12 }]);   // the month is over: it never came
    expect(worthALook(here, hist, '2026-10-13')).toEqual([{ kind: 'missing', note: 'Wi-Fi', day: 12 }]);
    expect(worthALook(here, hist.filter(p => p.month > '2026-07-01'), '2026-10-13')).toEqual([]);   // only two closed months: no habit
  });
});

describe('forecast', () => {
  it('stretches the bazar pace over the month and prices my meals at the ending rate', () => {
    // 10 days, ৳3,000 bazar; 30-day month -> ৳9,000; 300 meals -> ৳30 per meal; my 40 meals -> ৳1,200
    expect(forecast(300000, 10, 30, 30000, 4000)).toEqual({ rate: 3000, food: 120000 });
  });
  it('appears on the seventh day, rounds to the poisha, and prices nobody at zero meals', () => {
    expect(forecast(100, 7, 31, 3, 1)).toEqual({ rate: 14767, food: 148 });   // 100 × 31 ÷ 7 = 443 poisha over 0.03 meals
    expect(forecast(300000, 10, 30, 30000, 0)).toEqual({ rate: 3000, food: 0 });
  });
  it('nothing before a week, without bazar, or without meals', () => {
    expect(forecast(300000, 6, 30, 30000, 4000)).toBeNull();
    expect(forecast(0, 10, 30, 30000, 4000)).toBeNull();
    expect(forecast(300000, 10, 30, 0, 0)).toBeNull();
  });
});

describe('the day series and the ring', () => {
  it('spend climbs by date and ignores pending rows and corrections', () => {
    const rows = [row({ type: 'bazar', amount: 100, date: '2026-09-01' }), row({ type: 'bill', amount: 50, date: '2026-09-03' }),
      row({ type: 'deposit', amount: 999, date: '2026-09-02' }), row({ type: 'bazar', amount: 7, date: '2026-09-02', status: 'pending' }), row({ type: 'bazar', amount: 9, date: '2026-09-02', forMonth: '2026-08-01' })];
    expect(runningSpend(rows, ['2026-09-01', '2026-09-02', '2026-09-03']).map(d => d.value)).toEqual([100, 100, 150]);
  });
  it('my plates per meal, guests marked, nothing before I moved in', () => {
    const me: MealMember = { id: 'a', joinedOn: '2026-09-02', leftOn: null, defaults: { b: false, l: true, d: true } };
    const out = myPlates(me, [{ memberId: 'a', date: '2026-09-02', meal: 'd', count: 3, guests: 2 }, { memberId: 'b', date: '2026-09-02', meal: 'd', count: 5, guests: 4 }], ['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(out).toEqual([{ meal: 'b', plates: 0, guests: 0 }, { meal: 'l', plates: 2, guests: 0 }, { meal: 'd', plates: 4, guests: 2 }]);
    // after my last day, and after the drawn days, nothing counts (guests included)
    const left = { ...me, leftOn: '2026-09-02' };
    const rows: MealChange[] = [{ memberId: 'a', date: '2026-09-02', meal: 'd', count: 3, guests: 2 }, { memberId: 'a', date: '2026-09-03', meal: 'd', count: 2, guests: 1 }];
    expect(myPlates(left, rows, ['2026-09-01', '2026-09-02', '2026-09-03']).at(-1)).toEqual({ meal: 'd', plates: 3, guests: 2 });
    expect(myPlates(me, rows, ['2026-09-01', '2026-09-02']).at(-1)).toEqual({ meal: 'd', plates: 3, guests: 2 });
  });
  it('a ring keeps four names and folds the rest', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ label: `B${i}`, value: 70 - i * 10 }));
    expect(slices(rows, 'Others').map(r => `${r.label}:${r.value}`)).toEqual(['B0:70', 'B1:60', 'B2:50', 'B3:40', 'Others:60']);
    expect(slices([{ label: 'x', value: 0 }, { label: 'y', value: 5 }], 'Others')).toEqual([{ label: 'y', value: 5 }]);
    // a no-note bill already called Others never becomes a second Others line
    const withOthers = [{ label: 'bazar', value: 900 }, { label: 'Others', value: 800 }, { label: 'Gas', value: 700 }, { label: 'Wifi', value: 600 }, { label: 'Rent', value: 500 }, { label: 'Net', value: 400 }];
    expect(slices(withOthers, 'Others').map(r => `${r.label}:${r.value}`)).toEqual(['bazar:900', 'Gas:700', 'Wifi:600', 'Rent:500', 'Others:1200']);
    expect(slices(withOthers.slice(0, 3), 'Others').map(r => r.label)).toEqual(['bazar', 'Gas', 'Others']);
  });
  it('a day outside the month stays out of the running spend', () => {
    expect(runningSpend([row({ type: 'bazar', amount: 5, date: '2026-08-31' })], ['2026-09-01']).map(d => d.value)).toEqual([0]);
  });
});

describe('pickDay', () => {
  it('snaps the pointer to the nearest drawn day and never past the last one', () => {
    expect(pickDay(0, 31, 30)).toBe(0);
    expect(pickDay(0.49 / 30, 31, 30)).toBe(0);
    expect(pickDay(0.51 / 30, 31, 30)).toBe(1);
    expect(pickDay(1, 31, 30)).toBe(30);
    expect(pickDay(0.9, 31, 9)).toBe(9);      // day 10 of a running month: later days are blank
    expect(pickDay(-0.2, 31, 9)).toBe(0);     // a drag past the left edge
  });
});

describe('mealGrid', () => {
  it('one cell per drawn day and meal: blank before I moved in, plates and guests after, adding up to my plates', () => {
    const me: MealMember = { id: 'a', joinedOn: '2026-09-02', leftOn: null, defaults: { b: false, l: true, d: true } };
    const rows: MealChange[] = [{ memberId: 'a', date: '2026-09-02', meal: 'd', count: 3, guests: 2 }, { memberId: 'a', date: '2026-09-03', meal: 'l', count: 0 },
      { memberId: 'b', date: '2026-09-02', meal: 'd', count: 5, guests: 4 }];
    const days = ['2026-09-01', '2026-09-02', '2026-09-03'];
    const g = mealGrid(me, rows, days);
    expect(g.d).toEqual([null, { plates: 3, guests: 2 }, { plates: 1, guests: 0 }]);
    expect(g.l).toEqual([null, { plates: 1, guests: 0 }, { plates: 0, guests: 0 }]);
    expect(g.b).toEqual([null, { plates: 0, guests: 0 }, { plates: 0, guests: 0 }]);
    for (const p of myPlates(me, rows, days)) {
      const cells = g[p.meal].filter(c => c !== null);
      expect([cells.reduce((a, c) => a + c.plates, 0), cells.reduce((a, c) => a + c.guests, 0)]).toEqual([p.plates, p.guests]);
    }
  });
});

describe('waterfall', () => {
  it('each step starts where the last ended and the last ends on the sum', () => {
    expect(waterfall([{ key: 'earlier', value: 500 }, { key: 'paid', value: 400 }, { key: 'cost', value: -1200 }])).toEqual([
      { key: 'earlier', value: 500, from: 0, to: 500 }, { key: 'paid', value: 400, from: 500, to: 900 }, { key: 'cost', value: -1200, from: 900, to: -300 }]);
    expect(waterfall([])).toEqual([]);
  });
});
