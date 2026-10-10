import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { saveMeal } from './meals-db';
import { addEntry, addRoom, openMonth, setRoom, type NewEntry } from './money-db';

const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  const version = async (m: string) => (await db<{ v: number }>(`select version as v from months where flat_id = $1 and month = $2`, [f.flatId, m]))[0]?.v;
  return { flatId: f.flatId, ids, nafis, version };
}

describe('month triggers', { timeout: 30000 }, () => {
  it('every write bumps its month, settings bump every open month, a closed month refuses writes', async () => {
    const { flatId, ids, nafis, version } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    const v0 = await version('2026-09-01');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000 }))).toBe('ok');
    expect(await version('2026-09-01')).toBe(v0 + 1);
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-06', meal: 'l', count: 0, guests: 0 }, false);
    expect(await version('2026-09-01')).toBe(v0 + 2);
    await db(`update flats set weight_b = 60 where id = $1`, [flatId]);
    expect(await version('2026-09-01')).toBe(v0 + 3);
    const room = await addRoom(db, flatId, nafis, 'Front', 0);
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, room)).toBe(true);
    expect(await version('2026-09-01')).toBe(v0 + 5);   // a new room and a room assignment
    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    await expect(addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100 }))).rejects.toThrow('month_closed');
    await expect(saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-07', meal: 'l', count: 0, guests: 0 }, false)).rejects.toThrow('month_closed');
    expect(await db(`select 1 from ledger where flat_id = $1 and amount_poisha = 100`, [flatId])).toEqual([]);
    // a month with no row yet can't be closed: writes into it need no lock
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-12-02', meal: 'l', count: 0, guests: 0 }, false);
  });

  it('an adjustment must name who it moves to and the month it corrects', async () => {
    const { flatId, ids, nafis } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    await expect(db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'adjustment', 100, $2, '2026-09-05', 'ok', $3)`, [flatId, ids.Tahsin, nafis.memberId])).rejects.toThrow();
  });
});
