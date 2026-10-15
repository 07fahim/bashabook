import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, type Entry, type NewEntry } from './money-db';
import { closeMonth } from './close';
import { costRows, lastMonths, spendByKind } from './charts';

const row = (p: Partial<Entry> & Pick<Entry, 'type' | 'amount'>): Entry =>
  ({ id: 'x', status: 'ok', note: null, paidBy: null, memberId: null, split: null, selected: [], date: '2026-09-05', createdBy: 'c', forMonth: null, moves: null, heldBy: null, ...p } as Entry);

describe('spendByKind', () => {
  it('bazar first, bills by note, biggest first; pending rows and corrections for another month stay out', () => {
    const rows = [row({ type: 'bazar', amount: 100 }), row({ type: 'bazar', amount: 200 }), row({ type: 'deposit', amount: 999 }),
      row({ type: 'bill', amount: 50, note: 'Gas' }), row({ type: 'bill', amount: 400, note: 'Rent' }), row({ type: 'bill', amount: 30, note: 'Gas' }),
      row({ type: 'bill', amount: 5, note: 'Rent', status: 'pending' }), row({ type: 'bazar', amount: 77, forMonth: '2026-08-01' })];
    expect(spendByKind(rows, 'Others')).toEqual([{ label: 'bazar', value: 300 }, { label: 'Rent', value: 400 }, { label: 'Gas', value: 80 }]);
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
  it('closed months only, oldest first, with rate and spend', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-08-01', lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const };
    const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry => ({ date: '2026-08-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 40000, memberId: ids.Tahsin }))).toBe('ok');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: 30000 }))).toBe('ok');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'bill', amount: 10000, note: 'Gas', split: 'equal' }))).toBe('ok');
    expect(await lastMonths(db, f.flatId, '2026-10-01')).toEqual([]);   // still open
    expect((await closeMonth(db, f.flatId, nafis, '2026-08-01', '2026-09-02', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    const out = await lastMonths(db, f.flatId, '2026-10-01');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ month: '2026-08-01', spend: 40000 });
    expect(out[0].rate).toBeGreaterThan(0);
    expect(await lastMonths(db, f.flatId, '2026-08-01')).toEqual([]);   // only months before the one asked
  });
});
