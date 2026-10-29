import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkAll, db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { checkEntry, fixEntry, toCheck } from './bazar';
import { addEntry, openMonth, rejectEntry, type NewEntry } from './money-db';
import { addCorrection, closeInfo, closeMonth } from './close';

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
    // the same bazar saved twice in September: a question on the close card, not a blocker
    for (let i = 0; i < 2; i++) expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: 45000, date: '2026-09-20' }))).toBe('ok');
    await checkAll(f.flatId);
    const info = await closeInfo(db, f.flatId, '2026-10-05');
    expect(info?.pending).toBe(1);
    expect(info?.looks).toEqual([{ kind: 'dup', type: 'bazar', date: '2026-09-20', amount: 45000, note: null, n: 2 }]);
    const r = await closeMonth(db, f.flatId, nafis, '2026-09-01', '2026-10-05', { cash: info!.held, bkash: 0, nagad: 0, bank: 0 });
    expect(r.result).toBe('pending');
  });

  it('a bazar or bill not Verified blocks its own month only; Verified everywhere closes', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4C', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'member' as const }, TODAY = '2026-10-05';
    await openMonth(db, f.flatId, '2026-09-01'); await openMonth(db, f.flatId, '2026-10-01');
    const bazar = randomUUID(), bill = randomUUID();
    // no `today`: the date rules are skipped, so Tahsin can add into September here
    expect(await addEntry(db, f.flatId, tahsin, e({ id: bazar, type: 'bazar', amount: 45000, paidBy: ids.Tahsin }))).toBe('ok');   // Nafis checks it
    expect(await addEntry(db, f.flatId, nafis, e({ id: bill, type: 'bill', amount: 30000, note: 'Gas', split: 'equal' }))).toBe('ok');   // flat money: Tahsin checks it
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 30000, memberId: ids.Nafis }))).toBe('ok');   // September's fund back to 0
    expect(await addEntry(db, f.flatId, tahsin, e({ type: 'bazar', amount: 10000, paidBy: ids.Tahsin, date: '2026-10-03' }), TODAY)).toBe('ok');   // October's: never blocks September
    const close = async () => closeMonth(db, f.flatId, nafis, '2026-09-01', TODAY, { cash: (await closeInfo(db, f.flatId, TODAY))!.held, bkash: 0, nagad: 0, bank: 0 });
    expect((await closeInfo(db, f.flatId, TODAY))?.pending).toBe(2);
    expect((await close()).result).toBe('pending');
    expect(await checkEntry(db, f.flatId, nafis, bazar, 'fix', 'receipt?', TODAY, '')).not.toBeNull();
    expect(await checkEntry(db, f.flatId, tahsin, bill, 'ok', null, TODAY, '')).not.toBeNull();
    expect((await closeInfo(db, f.flatId, TODAY))?.pending).toBe(1);
    expect((await close()).result).toBe('pending');   // Needs correction blocks too
    // September is last month: only the collector may fix it now (a flatmate fixes only this month's, as with removing)
    expect((await fixEntry(db, f.flatId, nafis, { id: bazar, type: 'bazar', amount: 45000, date: '2026-09-06', paidBy: ids.Tahsin, note: null, items: [], receipt: null }, TODAY)).result).toBe('ok');
    expect(await checkEntry(db, f.flatId, nafis, bazar, 'ok', null, TODAY, '')).not.toBeNull();
    expect((await closeInfo(db, f.flatId, TODAY))?.pending).toBe(0);
    expect((await close()).result).toBe('ok');
  });

  it('a monthly bill from openMonth and a correction start waiting for a check', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4D', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });
    const [t] = await db<{ id: string }>(`update members set pin_hash = 'x' where flat_id = $1 and role = 'member' returning id`, [f.flatId]);   // Tahsin claimed his name
    const nafis = { memberId: f.memberId, role: 'manager' as const };
    await openMonth(db, f.flatId, '2026-09-01');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'bill', amount: 30000, note: 'Wi-Fi', split: 'equal', repeat: true, date: '2026-09-02' }), '2026-09-02')).toBe('ok');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 30000, memberId: f.memberId, date: '2026-09-02' }), '2026-09-02')).toBe('ok');   // fund back to 0
    await openMonth(db, f.flatId, '2026-10-01');   // copies the monthly bill into October
    await checkAll(f.flatId);   // September's own
    await db(`delete from entry_checks where flat_id = $1 and month = '2026-10-01'::text::date`, [f.flatId]);   // checkAll ran on October's too
    expect((await closeMonth(db, f.flatId, nafis, '2026-09-01', '2026-10-05', { cash: (await closeInfo(db, f.flatId, '2026-10-05'))!.held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
    expect((await addCorrection(db, f.flatId, nafis, { id: randomUUID(), kind: 'bazar', forMonth: '2026-09-01', amount: 5000, note: 'forgot', paidBy: t.id }, '2026-10-05'))).toBe('ok');
    // the monthly bill is the collector's own (flat money): Tahsin checks it. The correction was added by the collector and
    // paid by Tahsin: both did something, nobody else lives here, so the collector checks it after all
    expect((await toCheck(db, f.flatId, t.id, '2026-10-05')).map(w => [w.type, w.note])).toEqual([['bill', 'Wi-Fi']]);
    expect((await toCheck(db, f.flatId, f.memberId, '2026-10-05')).map(w => [w.type, w.note])).toEqual([['bazar', 'forgot']]);
  });

  it('Money received waiting for its giver blocks the close; after That’s not right the close goes through', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4E', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, tahsin = { memberId: ids.Tahsin, role: 'member' as const }, TODAY = '2026-10-05';
    await db(`update members set pin_hash = 'x' where id = $1`, [ids.Tahsin]);   // Tahsin has joined: he answers
    await openMonth(db, f.flatId, '2026-09-01'); await openMonth(db, f.flatId, '2026-10-01');
    const id = randomUUID();
    expect(await addEntry(db, f.flatId, nafis, e({ id, type: 'deposit', amount: 20000, memberId: ids.Tahsin }))).toBe('ok');
    const close = async () => closeMonth(db, f.flatId, nafis, '2026-09-01', TODAY, { cash: (await closeInfo(db, f.flatId, TODAY))!.held, bkash: 0, nagad: 0, bank: 0 });
    expect((await closeInfo(db, f.flatId, TODAY))?.pending).toBe(1);
    expect((await close()).result).toBe('pending');
    expect(await rejectEntry(db, f.flatId, tahsin, id)).toBe(ids.Nafis);
    expect((await close()).result).toBe('ok');
  });
  it('money from or to a flatmate who has not joined counts at once: it never blocks the close', async () => {
    await migrate();
    const f = await createFlat(db, { flatName: 'Flat 4F', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-09-01', lang: 'bn' });   // Tahsin hasn't joined
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    const nafis = { memberId: ids.Nafis, role: 'manager' as const }, TODAY = '2026-10-05';
    await openMonth(db, f.flatId, '2026-09-01'); await openMonth(db, f.flatId, '2026-10-01');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 20000, memberId: ids.Tahsin }))).toBe('ok');
    expect(await addEntry(db, f.flatId, nafis, e({ type: 'payout', amount: 5000, memberId: ids.Tahsin }))).toBe('ok');
    expect((await closeInfo(db, f.flatId, TODAY))?.pending).toBe(0);
    expect((await closeMonth(db, f.flatId, nafis, '2026-09-01', TODAY, { cash: (await closeInfo(db, f.flatId, TODAY))!.held, bkash: 0, nagad: 0, bank: 0 })).result).toBe('ok');
  });
});
