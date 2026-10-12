import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { changePin, createFlat, createSession, flatByCode, listMembers, login, newFlatCode, resetPin, setPhone } from './auth';
import { loadHistory } from './meals-db';
import { addEntry, openMonth } from './money-db';
import { getDictionary } from '../app/[lang]/dictionaries';

// The permanent PIN lock, policy approved 2026-10-12: tries 5, 10, 15, 20 lock for a while; the 25th locks until a reset.
const today = '2026-10-09';
async function flat() {
  await migrate();
  const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin'], today, lang: 'bn' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const tahsin = (await flatByCode(db, code))!.members.find(m => m.name === 'Tahsin')!.id;
  expect(await login(db, code, tahsin, '5678', null)).toEqual({ memberId: tahsin });   // claims the name
  await openMonth(db, flatId, '2026-10-01');
  return { flatId, memberId, code, tahsin };
}
const unlockTemp = (id: string) => db(`update members set locked_until = null where id = $1 and locked_until <> 'infinity'`, [id]);
const wrong = async (code: string, id: string, n: number) => { for (let i = 0; i < n; i++) { await login(db, code, id, '0000', null); await unlockTemp(id); } };
const lockRows = async (id: string) => (await db(`select 1 from audit_log where entity = 'members' and entity_id = $1 and after ? 'locked'`, [id])).length;
const state = async (id: string) => (await db<{ n: number; forGood: boolean }>(`select failed_pin_count as n, coalesce(locked_until = 'infinity', false) as "forGood" from members where id = $1`, [id]))[0];

describe('permanent PIN lock', { timeout: 60000 }, () => {
  it('1: the 25th wrong try locks for good; the 24th does not', async () => {
    const { code, tahsin } = await flat();
    await wrong(code, tahsin, 24);
    expect(await state(tahsin)).toEqual({ n: 24, forGood: false });
    expect(await login(db, code, tahsin, '0000', null)).toEqual({ error: 'lockedForGood' });   // the 25th says so at once
    expect(await state(tahsin)).toEqual({ n: 25, forGood: true });
    expect(await login(db, code, tahsin, '5678', null)).toEqual({ error: 'lockedForGood' });
    expect(await lockRows(tahsin)).toBe(1);   // once, and never again on later tries
  });

  it('1b: the right PIN on the 25th try signs in, and no lock goes in the history', async () => {
    const { code, tahsin } = await flat();
    await wrong(code, tahsin, 24);
    expect(await login(db, code, tahsin, '5678', null)).toEqual({ memberId: tahsin });
    expect(await state(tahsin)).toEqual({ n: 0, forGood: false });
    expect(await lockRows(tahsin)).toBe(0);
  });

  it('1c: from the 20th wrong try on, the message says how many are left', async () => {
    const { code, tahsin } = await flat();
    await wrong(code, tahsin, 19);
    for (const left of [5, 4, 3, 2, 1]) { expect(await login(db, code, tahsin, '0000', null)).toEqual({ error: 'wrongPin', left }); await unlockTemp(tahsin); }
    expect(await login(db, code, tahsin, '0000', null)).toEqual({ error: 'lockedForGood' });
  });

  it('2: parallel wrong tries cannot pass the limit', async () => {
    const { code, tahsin } = await flat();
    await wrong(code, tahsin, 20);
    await Promise.all(Array.from({ length: 40 }, () => login(db, code, tahsin, '0000', null)));
    expect(await state(tahsin)).toEqual({ n: 25, forGood: true });
    expect(await lockRows(tahsin)).toBe(1);
  });

  it('3: a right PIN, a PIN change and other actions do not clear a permanent lock', async () => {
    const { code, tahsin } = await flat();
    const token = await createSession(db, tahsin);   // a phone signed in before the lock
    await wrong(code, tahsin, 25);
    expect(await login(db, code, tahsin, '5678', null)).toEqual({ error: 'lockedForGood' });
    expect(await changePin(db, tahsin, '5678', '9999', token)).toEqual({ error: 'lockedForGood' });
    await setPhone(db, tahsin, '01712345678');
    expect(await state(tahsin)).toEqual({ n: 25, forGood: true });
  });

  it('4: only the collector reset clears it, and money, roles and history stay as they were', async () => {
    const { flatId, memberId, code, tahsin } = await flat();
    expect(await addEntry(db, flatId, { memberId: tahsin, role: 'member' }, { type: 'bazar', amount: 245000, date: today, note: null, paidBy: tahsin, memberId: null, split: null, selected: [] }, today)).toBe('ok');
    const before = async () => ({
      ledger: await db(`select id, amount_poisha, status, paid_by_member_id from ledger where flat_id = $1 order by id`, [flatId]),
      roles: await db(`select id, role, name, joined_on, left_on from members where flat_id = $1 order by name`, [flatId]),
      history: await db(`select id, entity, after from audit_log where flat_id = $1 and after->>'locked' is null order by id`, [flatId]),
    });
    const was = await before();
    await wrong(code, tahsin, 25);
    expect(await resetPin(db, flatId, tahsin, '4321', { memberId: tahsin })).toBe(false);   // not by themselves
    expect(await resetPin(db, flatId, tahsin, '4321', { memberId })).toBe(true);
    expect(await state(tahsin)).toEqual({ n: 0, forGood: false });
    expect(await login(db, code, tahsin, '4321', null)).toEqual({ error: 'newPinNeeded' });
    expect(await login(db, code, tahsin, '4321', '2468')).toEqual({ memberId: tahsin });
    const now = await before();
    expect(now.ledger).toEqual(was.ledger);
    expect(now.roles).toEqual(was.roles);
    expect(now.history.slice(0, was.history.length)).toEqual(was.history);   // only the reset row was added
    expect(now.history.length).toBe(was.history.length + 1);
  });

  it('5: the collector sees the lock in the history and on the Flat tab; nothing holds a PIN', async () => {
    const { flatId, code, tahsin } = await flat();
    await wrong(code, tahsin, 25);
    const rows = await loadHistory(db, flatId);
    const lock = rows.find(r => r.after.locked);
    expect(lock?.entityId).toBe(tahsin);
    expect(lock?.after).toEqual({ locked: 25 });
    expect((await listMembers(db, flatId)).find(m => m.id === tahsin)).toMatchObject({ locked: true, failed: 25 });
    const everything = JSON.stringify(await db(`select after, before from audit_log where flat_id = $1`, [flatId]));
    for (const pin of ['5678', '0000', '1234']) expect(everything).not.toContain(pin);
  });

  it('6: both languages say what a permanent lock means', () => {
    for (const lang of ['en', 'bn'] as const) {
      const t = getDictionary(lang);
      expect(t.app.errors.lockedForGood).toContain('25');
      expect(t.app.errors.lockedForGood).not.toBe(t.app.errors.locked);
      expect(t.meals.lockedHistory).toContain('25');
      expect(t.app.errors.lastTries).toContain('{n}');
    }
  });

  it('7: a locked collector is reset by the app team, with a reason, and keeps the money', async () => {
    const { flatId, memberId, code } = await flat();
    await wrong(code, memberId, 25);
    expect(await login(db, code, memberId, '1234', null)).toEqual({ error: 'lockedForGood' });
    expect(await resetPin(db, flatId, memberId, '7777', { admin: 'Fahim', reason: 'locked, verified by phone' })).toBe(true);
    expect(await login(db, code, memberId, '7777', '1357')).toEqual({ memberId });
    expect((await db<{ role: string }>(`select role from members where id = $1`, [memberId]))[0].role).toBe('manager');
  });

  it('8: a new join code stops the old one everywhere, and unlocks nobody', async () => {
    const { flatId, memberId, code, tahsin } = await flat();
    await wrong(code, tahsin, 25);
    expect(await newFlatCode(db, flatId, { memberId, role: 'manager' })).toMatch(/^[A-Z0-9]{6}$/);
    expect(await flatByCode(db, code)).toBeNull();
    expect(await login(db, code, tahsin, '5678', null)).toEqual({ error: 'notFound' });
    expect(await login(db, code, memberId, '1234', null)).toEqual({ error: 'notFound' });
    const [{ join_code: fresh }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
    expect(await login(db, fresh, tahsin, '5678', null)).toEqual({ error: 'lockedForGood' });
    expect(await login(db, fresh, memberId, '1234', null)).toEqual({ memberId });
  });
});
