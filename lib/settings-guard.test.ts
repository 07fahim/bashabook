import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { setDefaults, updateSettings } from './meals-db';
import { addEntry, addRoom, loadMonth, openMonth, setRent, setRoom, type NewEntry } from './money-db';
import { closeMonth } from './close';

// Plan 7 item 1: on 2 October, September has ended but isn't closed. A room, rent or meal-weight change that would change
// September's bill is refused unless the collector ticks that it fixes September. The two confirmed cases: Tahsin's September
// rent ৳500 (→ ৳1,500 if moved to the big room) and his September food ৳2,571.43 (→ ৳2,250 if breakfast weighs 1).
const OCT2 = '2026-10-02', OCT2_NOW = '2026-10-02T10:00', SEP = '2026-09-01';
const W = { b: 50, l: 100, d: 100 }, W1 = { b: 100, l: 100, d: 100 };
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
const cash = (t: number) => ({ cash: t, bkash: 0, nagad: 0, bank: 0 });

async function flat(roomBill = true) {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: SEP, lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await setDefaults(db, f.flatId, ids.Tahsin, { b: false, l: true, d: true }, null, '2026-08-31');   // Tahsin never eats breakfast
  await openMonth(db, f.flatId, SEP);
  const big = (await addRoom(db, f.flatId, nafis, 'Big', 300000)) as string, small = (await addRoom(db, f.flatId, nafis, 'Small', 100000)) as string;
  for (const [n, r] of [['Nafis', big], ['Tahsin', small], ['Zarif', small]]) await setRoom(db, f.flatId, nafis, ids[n], r);
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'deposit', amount: 1300000, memberId: ids.Tahsin }))).toBe('ok');
  if (roomBill) expect(await addEntry(db, f.flatId, nafis, e({ type: 'bill', amount: 400000, note: 'Rent', split: 'room' }))).toBe('ok');
  expect(await addEntry(db, f.flatId, nafis, e({ type: 'bazar', amount: 900000 }))).toBe('ok');
  await openMonth(db, f.flatId, '2026-10-01');
  const tahsin = async () => (await loadMonth(db, f.flatId, SEP, OCT2)).result.perMember.find(p => p.id === ids.Tahsin)!;
  const fund = async () => (await loadMonth(db, f.flatId, SEP, OCT2)).result.fund;
  return { flatId: f.flatId, ids, nafis, big, small, tahsin, fund };
}
const fix = (yes: boolean) => ({ today: OCT2, fix: yes });

describe('settings changes while an ended month is still open', { timeout: 30000 }, () => {
  it('moving Tahsin: refused without the tick (September rent stays ৳500), a deliberate fix with it (৳1,500), noted in history', async () => {
    const { flatId, ids, nafis, big, tahsin } = await flat();
    expect((await tahsin()).billShare).toBe(50000);
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, big, fix(false))).toBe('earlier');
    expect((await tahsin()).billShare).toBe(50000);
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, big, fix(true))).toBe(true);
    expect((await tahsin()).billShare).toBe(150000);
    const [a] = await db<{ after: { fixFor?: string } }>(`select after from audit_log where flat_id = $1 and entity = 'rooms' and entity_id = $2 order by id desc limit 1`, [flatId, ids.Tahsin]);
    expect(a.after.fixFor).toBe(SEP);
  });

  it('meal weights: refused without the tick (September food stays ৳2,571.43), a deliberate fix with it (৳2,250)', async () => {
    const { flatId, ids, tahsin } = await flat();
    expect((await tahsin()).foodCost).toBe(257143);
    expect(await updateSettings(db, flatId, ids.Nafis, { cutoff: '22:00', weights: W1 }, OCT2_NOW, false)).toBe('earlier');
    expect((await tahsin()).foodCost).toBe(257143);
    expect(await updateSettings(db, flatId, ids.Nafis, { cutoff: '22:00', weights: W1 }, OCT2_NOW, true)).toBe('ok');
    expect((await tahsin()).foodCost).toBe(225000);
  });

  it('rent shares and a new paying room are asked about too; nothing changes without the tick', async () => {
    const { flatId, nafis, big, tahsin } = await flat();
    expect(await setRent(db, flatId, nafis, big, 350000, fix(false))).toBe('earlier');
    expect(await addRoom(db, flatId, nafis, 'Extra', 50000, fix(false))).toBe('earlier');
    expect((await tahsin()).billShare).toBe(50000);
    expect((await loadMonth(db, flatId, SEP, OCT2)).rooms.map(r => r.name)).toEqual(['Big', 'Small']);
  });

  it('not asked when September’s bill can’t change: an October newcomer’s room, a ৳0 room, the lock time alone, no room bill', async () => {
    const { flatId, ids, nafis, big } = await flat();
    const [rafi] = await db<{ id: string }>(`insert into members (flat_id, name, joined_on) values ($1, 'Rafi', '2026-10-03') returning id`, [flatId]);
    expect(await setRoom(db, flatId, nafis, rafi.id, big, fix(false))).toBe(true);
    expect(typeof await addRoom(db, flatId, nafis, 'Box', 0, fix(false))).toBe('string');
    expect(await updateSettings(db, flatId, ids.Nafis, { cutoff: '21:30', weights: W }, OCT2_NOW, false)).toBe('ok');
    const other = await flat(false);   // a September with no bill split by room
    expect(await setRoom(db, other.flatId, other.nafis, other.ids.Tahsin, other.big, fix(false))).toBe(true);
  });

  it('after September closes the same changes go ahead without asking, and September stays as it closed', async () => {
    const { flatId, ids, nafis, big, fund, tahsin } = await flat();
    expect((await closeMonth(db, flatId, nafis, SEP, OCT2, cash(await fund()))).result).toBe('ok');
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, big, fix(false))).toBe(true);
    expect(await updateSettings(db, flatId, ids.Nafis, { cutoff: '22:00', weights: W1 }, OCT2_NOW, false)).toBe('ok');
    expect([(await tahsin()).billShare, (await tahsin()).foodCost]).toEqual([50000, 257143]);
  });
});
