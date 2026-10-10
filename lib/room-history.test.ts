import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { loadHistory } from './meals-db';
import { addEntry, addRoom, listRepeats, openMonth, setRent, setRoom, stopRepeat } from './money-db';

// Plan 7 item 10: room, rent-share and monthly-bill changes show in the flat's history for everyone, with who, when, and the
// old value read from the database at the change (never sent by the form).
const OCT2 = '2026-10-02';

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-10-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await openMonth(db, f.flatId, '2026-10-01');
  const big = (await addRoom(db, f.flatId, nafis, 'Big', 300000)) as string, small = (await addRoom(db, f.flatId, nafis, 'Small', 100000)) as string;
  return { flatId: f.flatId, ids, nafis, big, small };
}

describe('room and rent history', { timeout: 30000 }, () => {
  it('a rent change saves the old rent from the database and shows for everyone, also under Only mine', async () => {
    const { flatId, ids, nafis, big } = await flat();
    expect(await setRent(db, flatId, nafis, big, 350000)).toBe(true);
    expect(await setRent(db, flatId, nafis, big, 400000)).toBe(true);
    for (const mine of [null, ids.Tahsin]) {
      const rows = (await loadHistory(db, flatId, mine)).filter(h => h.entity === 'rooms' && h.after.name === 'Big');
      expect(rows.map(h => [h.before?.rent_share_poisha ?? null, h.after.rent_share_poisha, h.actor])).toEqual([
        [350000, 400000, 'Nafis'], [300000, 350000, 'Nafis'], [null, 300000, 'Nafis']]);   // newest first; adding the room has no old value
    }
  });

  it('moving someone saves the old and new room by name; no room is null', async () => {
    const { flatId, ids, nafis, big, small } = await flat();
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, small)).toBe(true);
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, big)).toBe(true);
    const rows = (await loadHistory(db, flatId, ids.Zarif)).filter(h => h.entity === 'rooms' && 'roomId' in h.after);
    expect(rows.map(h => [h.who, h.before?.room ?? null, h.after.room])).toEqual([['Tahsin', 'Small', 'Big'], ['Tahsin', null, 'Small']]);
    expect(rows[1].before).toEqual({ roomId: null, room: null });
  });

  it('a refused change, or saving the same value again, writes no history', async () => {
    const { flatId, ids, nafis, big } = await flat();
    const before = (await loadHistory(db, flatId)).length;
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, '00000000-0000-0000-0000-000000000000')).toBe(false);   // no such room
    expect(await setRent(db, flatId, { memberId: ids.Tahsin, role: 'member' }, big, 1)).toBe(false);          // not the collector
    expect(await setRent(db, flatId, nafis, big, 300000)).toBe(false);                                         // Save with the same rent
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, null)).toBe(false);                                    // still no room
    expect((await loadHistory(db, flatId)).length).toBe(before);
  });

  it('a monthly bill started and stopped shows with who, name and amount', async () => {
    const { flatId, ids, nafis } = await flat();
    expect(await addEntry(db, flatId, nafis, { type: 'bill', amount: 1200000, date: OCT2, note: 'Rent', paidBy: null, memberId: null, split: 'equal', selected: [], repeat: true }, OCT2)).toBe('ok');
    const [rp] = await listRepeats(db, flatId);
    expect(await stopRepeat(db, flatId, nafis, rp.id)).toBe(true);
    const rows = (await loadHistory(db, flatId, ids.Tahsin)).filter(h => h.entity === 'bill_templates');
    expect(rows.map(h => [h.actor, !!h.after.removed, (h.after.removed ? h.before : h.after)?.name, (h.after.removed ? h.before : h.after)?.amount_poisha]))
      .toEqual([['Nafis', true, 'Rent', 1200000], ['Nafis', false, 'Rent', 1200000]]);
  });
});
