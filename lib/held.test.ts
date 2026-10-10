import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, loadMonth, openMonth, type NewEntry } from './money-db';
import { closeInfo, closeMonth } from './close';
import { flatMoney } from './handover';

// Plan 7 items 2 and 3: on 2 October the collector holds September's money plus October's. The close count, Home and Money
// must use that total, not one month's fund. September: deposit ৳3,000, bazar ৳1,000 (fund ৳2,000); October 2: bazar ৳500.
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
const cash = (t: number) => ({ cash: t, bkash: 0, nagad: 0, bank: 0 });
const OCT2 = '2026-10-02';

async function flat(octBazar: number) {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await openMonth(db, f.flatId, '2026-09-01');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 300000, memberId: ids.Tahsin }))).toBe('ok');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: 100000 }))).toBe('ok');
  await openMonth(db, f.flatId, '2026-10-01');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: octBazar, date: OCT2 }))).toBe('ok');
  return { flatId: f.flatId, nafis };
}

describe('money held across open months', { timeout: 30000 }, () => {
  it('item 2: closing September counts the ৳1,500 actually held, not September’s ৳2,000', async () => {
    const { flatId, nafis } = await flat(50000);
    expect(await closeInfo(db, flatId, OCT2)).toMatchObject({ month: '2026-09-01', fund: 200000, held: 150000, later: -50000 });
    const wrong = await closeMonth(db, flatId, nafis, '2026-09-01', OCT2, cash(200000));
    expect([wrong.result, wrong.expected]).toEqual(['cash', 150000]);
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', OCT2, cash(150000))).result).toBe('ok');
    const [m] = await db<{ fund: number; cash: { expected: number; actual: number } }>(
      `select closing_fund::int as fund, cash from months where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    expect([m.fund, m.cash.expected, m.cash.actual]).toEqual([200000, 150000, 150000]);   // September's own fund stays frozen
    expect((await loadMonth(db, flatId, '2026-10-01', OCT2)).result.fund).toBe(150000);   // October carries it once
  });

  it('item 2: when October was overspent from the collector’s own pocket, the count to close September is ৳0', async () => {
    const { flatId, nafis } = await flat(250000);   // ৳2,500 bazar in October: ৳500 more than the flat had
    expect(await closeInfo(db, flatId, OCT2)).toMatchObject({ fund: 200000, held: 0, later: -250000 });
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', OCT2, cash(0))).result).toBe('ok');
    expect((await loadMonth(db, flatId, '2026-10-01', OCT2)).result.fund).toBe(-50000);   // the flat owes the collector ৳500
  });

  it('item 3: while September is open, October’s own fund is −৳500 but the money held is ৳1,500', async () => {
    const { flatId } = await flat(50000);
    expect((await loadMonth(db, flatId, '2026-10-01', OCT2)).result.fund).toBe(-50000);   // what Home and Money showed before
    expect(await flatMoney(db, flatId, OCT2)).toBe(150000);                               // what they must show
  });
});
