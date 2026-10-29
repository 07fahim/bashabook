import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat, createSession } from './auth';
import { closeMonth } from './close';
import { deleteFlat, flatRowCounts, FLAT_TABLES } from './delete-flat';
import { flatMoney, offerHandover } from './handover';
import { noCooking, saveMeal } from './meals-db';
import { addEntry, addRoom, openMonth } from './money-db';

describe('deleting a flat', { timeout: 30000 }, () => {
  it('takes every row of that flat with it, in one statement, and nothing of another flat', async () => {
    await migrate();
    const mk = async (flatName: string) => {
      const f = await createFlat(db, { flatName, name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });
      const [t] = await db<{ id: string }>(`select id from members where flat_id = $1 and role = 'member'`, [f.flatId]);
      const boss = { memberId: f.memberId, role: 'manager' as const };
      await openMonth(db, f.flatId, '2026-09-01'); await openMonth(db, f.flatId, '2026-10-01');
      await addRoom(db, f.flatId, boss, 'A', 100);
      await addEntry(db, f.flatId, boss, { type: 'bazar', amount: 90000, date: '2026-09-05', note: null, paidBy: t.id, memberId: null, split: null, selected: [] });
      const [bz] = await db<{ id: string }>(`select id from ledger where flat_id = $1 and type = 'bazar'`, [f.flatId]);
      await db(`insert into bazar_items (flat_id, ledger_id, pos, name) values ($1, $2, 0, 'Rice')`, [f.flatId, bz.id]);
      await db(`insert into receipts (flat_id, ledger_id, month, photo) values ($1, $2, '2026-09-01'::text::date, $3)`, [f.flatId, bz.id, Buffer.from([0xff, 0xd8, 0xff, 0])]);
      await db(`insert into entry_checks (flat_id, ledger_id, month, state, by_member) values ($1, $2, '2026-09-01'::text::date, 'ok', $3)`, [f.flatId, bz.id, t.id]);
      await addEntry(db, f.flatId, boss, { type: 'bill', amount: 30000, date: '2026-10-05', note: 'Gas', paidBy: null, memberId: null, split: 'selected', selected: [t.id], repeat: true }, '2026-10-09');
      await saveMeal(db, f.flatId, t.id, { memberId: t.id, date: '2026-10-10', meal: 'l', count: 0, guests: 0 }, false);
      await noCooking(db, f.flatId, f.memberId, '2026-10-12', '2026-10-12', ['d'], '2026-10-09');
      expect((await closeMonth(db, f.flatId, boss, '2026-09-01', '2026-10-09', { cash: 0, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
      await createSession(db, f.memberId);
      await db(`update members set pin_hash = 'x' where id = $1`, [t.id]);
      await addEntry(db, f.flatId, boss, { type: 'deposit', amount: 30000, date: '2026-10-06', note: null, paidBy: null, memberId: f.memberId, split: null, selected: [] }, '2026-10-09');   // flat money back to 0
      expect(await offerHandover(db, f.flatId, boss, t.id, await flatMoney(db, f.flatId, '2026-10-09'), '2026-10-09')).toBe('ok');
      return f.flatId;
    };
    const a = await mk('A'), b = await mk('B');
    const before = await flatRowCounts(db, a), other = await flatRowCounts(db, b);
    for (const t of FLAT_TABLES) expect(before[t], t).toBeGreaterThan(0);   // every table has rows to lose
    expect(await deleteFlat(db, a)).toBe(true);
    expect(await flatRowCounts(db, a)).toEqual(Object.fromEntries(FLAT_TABLES.map(t => [t, 0])));
    expect(await flatRowCounts(db, b)).toEqual(other);
    expect(await deleteFlat(db, a)).toBe(false);
  });
});
