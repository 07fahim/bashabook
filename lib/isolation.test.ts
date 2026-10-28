import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { checkAll, db, migrate } from '../db/test-db';
import { addMember, bringBack, createFlat, createSession, deleteSession, listMembers, login, memberBySession, renameMember, resetPin, setLeaving } from './auth';
import { checkEntry, entryDetail, fixEntry, itemsFor, receiptOf, toCheck } from './bazar';
import { addCorrection, closeMonth } from './close';
import { acceptHandover, offerHandover } from './handover';
import { setOtherMeal } from './meals-db';
import { addEntry, confirmEntry, openMonth, putBack, removeEntry, setRent, setRoom, stopRepeat, type NewEntry } from './money-db';
import { removePhoto, setPhoto } from './photo';

const today = '2026-10-09', OCT = '2026-10-01', SEP = '2026-09-01', noCash = { cash: 0, bkash: 0, nagad: 0, bank: 0 };
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-10-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

/** Two flats, each with its collector (boss) and one flatmate (other). */
async function two() {
  await migrate();
  const mk = async (flatName: string, name: string, other: string) => {
    const f = await createFlat(db, { flatName, name, pin: '1234', others: [other], today: SEP, lang: 'bn' });
    const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
    await openMonth(db, f.flatId, SEP); await openMonth(db, f.flatId, OCT);
    return { flatId: f.flatId, boss: { memberId: f.memberId, role: 'manager' as const }, other: ids[other], member: { memberId: ids[other], role: 'member' as const } };
  };
  return { A: await mk('A', 'Nafis', 'Tahsin'), B: await mk('B', 'Zarif', 'Rafi') };
}

describe('flat isolation', { timeout: 60000 }, () => {
  it('a session from flat A cannot read or change flat B', async () => {
    await migrate();
    const a = await createFlat(db, { flatName: 'A', name: 'Nafis', pin: '1234', others: ['Tahsin'], today, lang: 'bn' });
    const b = await createFlat(db, { flatName: 'B', name: 'Zarif', pin: '1234', others: ['Rafi'], today, lang: 'bn' });

    const me = (await memberBySession(db, await createSession(db, a.memberId)))!;
    expect(me.flatId).toBe(a.flatId);
    expect((await listMembers(db, me.flatId)).map(m => m.name)).toEqual(['Nafis', 'Tahsin']);
    expect(await resetPin(db, me.flatId, b.memberId, '0000', { memberId: me.memberId })).toBe(false);
    expect(await addMember(db, me.flatId, 'Zarif', today, me.memberId)).toBe(true);
    expect((await listMembers(db, b.flatId)).map(m => m.name)).toEqual(['Zarif', 'Rafi']);

    const [{ join_code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [a.flatId]);
    expect(await login(db, join_code, b.memberId, '1234', null)).toEqual({ error: 'notFound' });
  });

  it('money: no entry, confirm, remove, put back, correction, room or monthly bill crosses a flat, even with the other flat’s ids', async () => {
    const { A, B } = await two();
    expect(await addEntry(db, B.flatId, B.member, e({ type: 'deposit', amount: 50000, memberId: B.other }), today)).toBe('ok');
    expect(await addEntry(db, B.flatId, B.boss, e({ type: 'bazar', amount: 20000, paidBy: B.other }), today)).toBe('ok');
    expect(await addEntry(db, B.flatId, B.boss, e({ type: 'bill', amount: 30000, note: 'Gas', split: 'equal', repeat: true }), today)).toBe('ok');
    const rows = await db<{ id: string; type: string; status: string }>(`select id, type, status from ledger where flat_id = $1`, [B.flatId]);
    const pending = rows.find(r => r.status === 'pending')!.id, bazar = rows.find(r => r.type === 'bazar')!.id, bill = rows.find(r => r.type === 'bill')!.id;
    expect(await removeEntry(db, B.flatId, B.boss, bill, today)).toBe(true);
    const [tpl] = await db<{ id: string }>(`select id from bill_templates where flat_id = $1`, [B.flatId]);
    const [room] = await db<{ id: string }>(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'R', 100) returning id`, [B.flatId]);

    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'bazar', amount: 100, paidBy: B.other }), today)).toBe('bad');
    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'deposit', amount: 100, memberId: B.other }), today)).toBe('bad');
    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'payout', amount: 100, memberId: B.other }), today)).toBe('bad');
    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'bill', amount: 100, note: 'x', split: 'selected', selected: [A.other] }), today)).toBe('ok');   // control
    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'bill', amount: 100, note: 'x', split: 'selected', selected: [B.other] }), today)).toBe('bad');
    expect(await confirmEntry(db, A.flatId, A.boss, pending)).toBe(false);
    expect(await removeEntry(db, A.flatId, A.boss, bazar, today)).toBe(false);
    expect(await putBack(db, A.flatId, A.boss.memberId, bill, today)).toBe(false);
    expect(await stopRepeat(db, A.flatId, A.boss, tpl.id)).toBe(false);
    expect(await setRent(db, A.flatId, A.boss, room.id, 500)).toBe(false);
    expect(await setRoom(db, A.flatId, A.boss, B.other, room.id)).toBe(false);
    expect(await setRoom(db, A.flatId, A.boss, A.other, room.id)).toBe(false);   // B's room
    const [roomA] = await db<{ id: string }>(`insert into rooms (flat_id, name, rent_share_poisha) values ($1, 'R', 100) returning id`, [A.flatId]);
    expect(await setRoom(db, A.flatId, A.boss, B.other, roomA.id)).toBe(false);   // B's person
    expect(await setRoom(db, A.flatId, A.boss, A.other, roomA.id)).toBe(true);    // control
    // a correction for A's closed September: fine between A's own people, refused for B's (A's ledger gets one row, not two)
    expect(await addEntry(db, A.flatId, A.boss, e({ type: 'bazar', amount: 100, paidBy: A.other, date: '2026-09-05' }))).toBe('ok');
    await checkAll(A.flatId);
    expect((await closeMonth(db, A.flatId, A.boss, SEP, today, noCash)).result).toBe('ok');
    expect(await addCorrection(db, A.flatId, A.boss, { id: randomUUID(), forMonth: SEP, amount: 100, note: 'x', kind: 'move', from: A.boss.memberId, to: A.other }, today)).toBe('ok');
    expect(await addCorrection(db, A.flatId, A.boss, { id: randomUUID(), forMonth: SEP, amount: 100, note: 'x', kind: 'move', from: B.other, to: B.boss.memberId }, today)).toBe('month');
    expect(await addCorrection(db, A.flatId, A.boss, { id: randomUUID(), forMonth: SEP, amount: 100, note: 'x', kind: 'bill', paidBy: A.boss.memberId, split: 'selected', selected: [B.other] }, today)).toBe('month');
    expect(await db(`select 1 from ledger where flat_id = $1 and for_month = $2`, [A.flatId, SEP])).toHaveLength(1);
    expect(await db(`select 1 from ledger where flat_id = $1`, [B.flatId])).toHaveLength(2);
    expect((await db<{ status: string }>(`select status from ledger where id = $1`, [pending]))[0].status).toBe('pending');
    expect(await db(`select 1 from bill_templates where flat_id = $1`, [B.flatId])).toHaveLength(1);
    expect((await db<{ r: number }>(`select rent_share_poisha::int as r from rooms where id = $1`, [room.id]))[0].r).toBe(100);
  });

  it('people: no rename, move-out, bring back, meal switch, photo removal or handover crosses a flat', async () => {
    const { A, B } = await two();
    expect(await renameMember(db, A.flatId, A.boss.memberId, B.other, 'X')).toBe('notFound');
    expect(await setLeaving(db, A.flatId, A.boss.memberId, B.other, '2026-10-20', today)).toBe('no');
    await db(`update members set left_on = '2026-10-05' where id = $1`, [B.other]);
    expect(await bringBack(db, A.flatId, A.boss.memberId, B.other, today, OCT)).toBe('no');
    await db(`update members set left_on = null where id = $1`, [B.other]);
    const soon = new Date(Date.now() + 6 * 3600_000 + 3 * 864e5).toISOString().slice(0, 10);   // Dhaka, three days ahead: open to a flatmate's switch
    expect(await setOtherMeal(db, A.flatId, A.boss.memberId, A.other, soon, 'l', 0, 1)).toBe('ok');   // control
    expect(await setOtherMeal(db, A.flatId, A.boss.memberId, B.other, soon, 'l', 0, 1)).toBe('closed');
    expect(await setPhoto(db, B.other, Uint8Array.from([0xff, 0xd8, 0xff, 0]))).toBe(true);
    expect(await removePhoto(db, { flatId: A.flatId, ...A.boss }, B.other)).toBe(false);
    await db(`update members set pin_hash = 'x' where id = $1`, [B.other]);   // eligible in B, so the refusal below is the flat
    expect(await offerHandover(db, A.flatId, A.boss, B.other, 0, today)).toBe('recipient');
    expect(await offerHandover(db, B.flatId, B.boss, B.other, 0, today)).toBe('ok');
    const [h] = await db<{ id: string }>(`select id from handovers where flat_id = $1`, [B.flatId]);
    expect(await acceptHandover(db, A.flatId, A.other, h.id)).toBe('gone');
    expect(await acceptHandover(db, B.flatId, A.other, h.id)).toBe('notYou');
    expect((await db<{ name: string; role: string }>(`select name, role from members where id = $1`, [B.other]))[0]).toEqual({ name: 'Rafi', role: 'member' });
  });

  it('bazar checks, fixes, item lines and receipts never cross a flat, even with the other flat’s ids', async () => {
    const { A, B } = await two();
    const id = randomUUID(), jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 1]);
    expect(await addEntry(db, B.flatId, B.member, e({ id, type: 'bazar', amount: 20000, paidBy: B.other, items: [{ name: 'Rice', amount: null }], receipt: jpeg }), today)).toBe('ok');
    expect(await receiptOf(db, A.flatId, id)).toBeNull();
    expect(await receiptOf(db, B.flatId, id)).not.toBeNull();   // control
    expect(await entryDetail(db, A.flatId, id, A.boss.memberId, today)).toBeNull();
    expect((await itemsFor(db, A.flatId, OCT)).size).toBe(0);
    expect(await toCheck(db, A.flatId, A.boss.memberId, today)).toEqual([]);
    expect(await checkEntry(db, A.flatId, A.boss, id, 'fix', 'x', today)).toBeNull();
    expect(await checkEntry(db, B.flatId, A.boss, id, 'fix', 'x', today)).toBeNull();   // A's collector named in B's flat
    expect(await checkEntry(db, B.flatId, B.boss, id, 'fix', 'x', today)).not.toBeNull();   // control
    expect((await fixEntry(db, A.flatId, A.boss, { id, amount: 100, date: '2026-10-05', paidBy: null, note: null, items: [], receipt: null }, today)).result).toBe('bad');
    expect(await db(`select 1 from entry_checks where ledger_id = $1 and state = 'fix'`, [id])).toHaveLength(1);
  });
});

describe('sessions', { timeout: 60000 }, () => {
  it('an expired, signed-out or unknown token is nobody; a new sign-in purges expired rows', async () => {
    const { A } = await two();
    const t1 = await createSession(db, A.boss.memberId), t2 = await createSession(db, A.boss.memberId);
    expect(await memberBySession(db, t1)).not.toBeNull();
    await db(`update sessions set expires_at = now() - interval '1 second' where member_id = $1`, [A.boss.memberId]);
    expect(await memberBySession(db, t1)).toBeNull();
    const t3 = await createSession(db, A.boss.memberId);
    expect(await db(`select 1 from sessions where member_id = $1`, [A.boss.memberId])).toHaveLength(1);
    await deleteSession(db, t3);
    expect(await memberBySession(db, t3)).toBeNull();
    expect(await memberBySession(db, t2)).toBeNull();
    expect(await memberBySession(db, 'not-a-token')).toBeNull();
  });
});
