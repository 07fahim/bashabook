import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { addEntry, openMonth, type NewEntry } from './money-db';
import { closeInfo, closeMonth } from './close';

const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

describe('close probe', { timeout: 30000 }, () => {
  it('a pending deposit in a later open month blocks the close like the card says', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    await openMonth(db, f.flatId, '2026-09-01');
    await openMonth(db, f.flatId, '2026-10-01');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 100000, memberId: ids.Nafis }))).toBe('ok');
    // Tahsin says he paid in October: pending until Nafis confirms
    expect(await addEntry(db, f.flatId, tahsin, e({ type: 'deposit', amount: 50000, memberId: ids.Tahsin, date: '2026-10-03' }))).toBe('ok');
    const info = await closeInfo(db, f.flatId, '2026-10-05');
    expect(info?.pending).toBe(1);
    const r = await closeMonth(db, f.flatId, nafis, '2026-09-01', '2026-10-05', { cash: info!.held, bkash: 0, nagad: 0, bank: 0 });
    expect(r.result).toBe('pending');
  });
});
