import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, type Entry, type NewEntry } from './money-db';
import { addCorrection, closeMonth } from './close';
import { costRows, lastMonths, platesPerDay, runningSpend, slices, spendByKind } from './charts';
import type { MealMember } from './meals';

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
    expect((await closeMonth(db, f.flatId, nafis, '2026-07-01', '2026-08-02', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    await month('2026-08', 30000);
    expect((await closeMonth(db, f.flatId, nafis, '2026-08-01', '2026-09-02', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    // September books a bazar Tahsin paid for August: August's own spend must not move
    expect(await addCorrection(db, f.flatId, nafis, { id: randomUUID(), kind: 'bazar', forMonth: '2026-08-01', amount: 5000, paidBy: ids.Tahsin, note: 'egg receipt' }, '2026-09-03')).toBe('ok');
    const out = await lastMonths(db, f.flatId, '2026-10-01');
    expect(out.map(m => [m.month, m.spend])).toEqual([['2026-07-01', 30000], ['2026-08-01', 40000]]);
    expect(out.every(m => m.rate > 0)).toBe(true);
    expect((await lastMonths(db, f.flatId, '2026-10-01', 1)).map(m => m.month)).toEqual(['2026-08-01']);   // the newest n
    expect(await lastMonths(db, f.flatId, '2026-07-01')).toEqual([]);   // only months before the one asked
  });
});

describe('the day series and the ring', () => {
  it('spend climbs by date and ignores pending rows and corrections', () => {
    const rows = [row({ type: 'bazar', amount: 100, date: '2026-09-01' }), row({ type: 'bill', amount: 50, date: '2026-09-03' }),
      row({ type: 'deposit', amount: 999, date: '2026-09-02' }), row({ type: 'bazar', amount: 7, date: '2026-09-02', status: 'pending' }), row({ type: 'bazar', amount: 9, date: '2026-09-02', forMonth: '2026-08-01' })];
    expect(runningSpend(rows, ['2026-09-01', '2026-09-02', '2026-09-03']).map(d => d.value)).toEqual([100, 100, 150]);
  });
  it('plates per day count everyone and their guests', () => {
    const m = (id: string): MealMember => ({ id, joinedOn: '2026-09-01', leftOn: null, defaults: { b: true, l: true, d: true } });
    const out = platesPerDay([m('a'), m('b')], [{ memberId: 'a', date: '2026-09-02', meal: 'd', count: 3 }], ['2026-09-01', '2026-09-02']);
    expect(out.map(d => d.value)).toEqual([6, 8]);
  });
  it('a ring keeps four names and folds the rest', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ label: `B${i}`, value: 70 - i * 10 }));
    expect(slices(rows, 'Others').map(r => `${r.label}:${r.value}`)).toEqual(['B0:70', 'B1:60', 'B2:50', 'B3:40', 'Others:60']);
    expect(slices([{ label: 'x', value: 0 }, { label: 'y', value: 5 }], 'Others')).toEqual([{ label: 'y', value: 5 }]);
  });
});
