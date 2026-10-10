import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, entryFrom, loadMonth, openMonth, type NewEntry } from './money-db';
import { closeMonth } from './close';

// Plan 7 item 4: on 2 October the collector finds a 28 September bazar nobody recorded. While September is open it can be
// added with its real date; a closed month still refuses it; flatmates still add to this month only.
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
const cash = (t: number) => ({ cash: t, bkash: 0, nagad: 0, bank: 0 });
const OCT2 = '2026-10-02';

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'member' as const };
  await openMonth(db, f.flatId, '2026-09-01');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 300000, memberId: ids.Tahsin }))).toBe('ok');
  await openMonth(db, f.flatId, '2026-10-01');
  return { flatId: f.flatId, nafis, tahsin };
}

describe('a forgotten entry in a month that is still open', { timeout: 30000 }, () => {
  it('the collector may date it from the oldest open month; a flatmate from this month only', async () => {
    const { flatId, nafis, tahsin } = await flat();
    expect(await entryFrom(db, flatId, nafis, OCT2)).toBe('2026-09-01');
    expect(await entryFrom(db, flatId, tahsin, OCT2)).toBe('2026-10-01');
  });

  it('a late September bazar lands in September, the count matches, and once closed September refuses more', async () => {
    const { flatId, nafis } = await flat();
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100000, date: '2026-09-28' }))).toBe('ok');
    const sep = await loadMonth(db, flatId, '2026-09-01', OCT2);
    expect([sep.entries.some(x => x.date === '2026-09-28' && x.type === 'bazar'), sep.result.fund]).toEqual([true, 200000]);
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', OCT2, cash(200000))).result).toBe('ok');
    expect(await entryFrom(db, flatId, nafis, OCT2)).toBe('2026-10-01');
    await expect(addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100, date: '2026-09-29' }))).rejects.toThrow('month_closed');
  });
});
