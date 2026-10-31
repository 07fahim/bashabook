import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { clearLock, clearedBefore, createFlat, flatByCode, listMembers, login, resetPin } from './auth';
import { loadHistory } from './meals-db';
import { addEntry, openMonth } from './money-db';
import { getDictionary } from '../app/[lang]/dictionaries';

// A flatmate clears another flatmate's lock (policy of 2026-10-13): PIN unchanged, 4 tries left, never self, never the
// collector, only people living here, only while locked; one history row; money and roles untouched.
const today = '2026-10-09';
async function flat() {
  await migrate();
  const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today, lang: 'bn' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const members = (await flatByCode(db, code))!.members;
  const id = (name: string) => members.find(m => m.name === name)!.id;
  const tahsin = id('Tahsin'), zarif = id('Zarif');
  expect(await login(db, code, tahsin, '5827', null)).toEqual({ memberId: tahsin });
  expect(await login(db, code, zarif, '9024', null)).toEqual({ memberId: zarif });
  await openMonth(db, flatId, '2026-10-01');
  return { flatId, nafis: memberId, code, tahsin, zarif };
}
const unlockTemp = (id: string) => db(`update members set locked_until = null where id = $1 and locked_until <> 'infinity'`, [id]);
const wrong = async (code: string, id: string, n: number) => { for (let i = 0; i < n; i++) { await login(db, code, id, '0000', null); await unlockTemp(id); } };
const state = async (id: string) => (await db<{ n: number; lock: string | null; hash: string }>(`select failed_pin_count as n, locked_until::text as lock, pin_hash as hash from members where id = $1`, [id]))[0];
const clears = async (id: string) => (await db(`select 1 from audit_log where entity = 'members' and entity_id = $1 and after ? 'lockCleared'`, [id])).length;

describe('a flatmate clears a lock', { timeout: 60000 }, () => {
  it('a permanent lock: PIN unchanged, 4 tries left, then locked for good again; one history row with who and whom', async () => {
    const { flatId, code, nafis, tahsin, zarif } = await flat();
    await wrong(code, tahsin, 25);
    const { hash } = await state(tahsin);
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(true);
    expect(await state(tahsin)).toEqual({ n: 20, lock: null, hash });
    expect(await login(db, code, tahsin, '0000', null)).toEqual({ error: 'wrongPin', left: 4 });
    expect(await login(db, code, tahsin, '5827', null)).toEqual({ memberId: tahsin });   // the right PIN still works
    await wrong(code, tahsin, 25);
    expect(await clearLock(db, flatId, tahsin, nafis)).toBe(true);   // another helper: Zarif's one clear is used up
    for (let i = 0; i < 4; i++) await login(db, code, tahsin, '0000', null);   // 4 more wrong tries are allowed
    expect(await state(tahsin)).toMatchObject({ n: 24, lock: null });
    expect(await login(db, code, tahsin, '0000', null)).toEqual({ error: 'lockedForGood' });   // the 5th locks for good again
    expect(await clears(tahsin)).toBe(2);
    const rows = (await loadHistory(db, flatId)).filter(r => r.after.lockCleared);   // newest first
    expect(rows).toMatchObject([{ actor: 'Nafis', who: 'Tahsin', entityId: tahsin }, { actor: 'Zarif', who: 'Tahsin', entityId: tahsin }]);
  });

  it('a timed lock: lifted, the count stays', async () => {
    const { flatId, code, tahsin, zarif } = await flat();
    for (let i = 0; i < 5; i++) await login(db, code, tahsin, '0000', null);
    expect(await login(db, code, tahsin, '5827', null)).toEqual({ error: 'locked' });
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(true);
    expect((await state(tahsin)).n).toBe(5);
    expect(await clears(tahsin)).toBe(1);
    expect(await login(db, code, tahsin, '5827', null)).toEqual({ memberId: tahsin });
  });

  it('refused: own lock, the collector, someone not locked, someone who moved out, an actor who moved out, another flat', async () => {
    const { flatId, code, nafis, tahsin, zarif } = await flat();
    await wrong(code, tahsin, 25);
    await wrong(code, nafis, 25);
    expect(await clearLock(db, flatId, tahsin, tahsin)).toBe(false);   // not by themselves
    expect(await clearLock(db, flatId, nafis, zarif)).toBe(false);    // never the collector
    expect(await clearLock(db, flatId, zarif, tahsin)).toBe(false);   // Zarif isn't locked: no tries taken away
    expect((await state(zarif)).n).toBe(0);
    const other = await createFlat(db, { flatName: 'Flat 9C', name: 'Rafi', pin: '1111', others: [], today, lang: 'en' });
    expect(await clearLock(db, other.flatId, tahsin, other.memberId)).toBe(false);   // another flat
    expect(await clearLock(db, flatId, tahsin, other.memberId)).toBe(false);         // an actor from another flat
    await db(`update members set left_on = current_date - 1 where id = $1`, [zarif]);   // Zarif moved out yesterday
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(false);
    await db(`update members set left_on = null where id = $1`, [zarif]);
    await db(`update members set left_on = current_date - 1 where id = $1`, [tahsin]);   // a locked person who moved out
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(false);
    expect(await state(tahsin)).toMatchObject({ n: 25, lock: 'infinity' });
    expect(await clears(tahsin)).toBe(0);
    // the collector's lock: only the app team
    expect(await resetPin(db, flatId, nafis, '7777', { admin: 'Fahim', reason: 'locked, verified by phone' })).toBe(true);
    expect(await login(db, code, nafis, '7777', '1357')).toEqual({ memberId: nafis });
  });

  it('one clear per helper per person between PIN resets: the same helper is refused, another helps, a reset starts over', async () => {
    const { flatId, code, nafis, tahsin, zarif } = await flat();
    await wrong(code, tahsin, 25);
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(true);
    await wrong(code, tahsin, 5);   // locked for good again
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(false);   // Zarif already did once
    expect(await clearedBefore(db, flatId, zarif)).toEqual(new Set([tahsin]));
    expect(await clearedBefore(db, flatId, nafis)).toEqual(new Set());
    expect(await state(tahsin)).toMatchObject({ n: 25, lock: 'infinity' });
    expect(await clearLock(db, flatId, tahsin, nafis)).toBe(true);   // the collector is a flatmate too
    await wrong(code, tahsin, 5);
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(false);
    expect(await resetPin(db, flatId, tahsin, '4321', { memberId: nafis })).toBe(true);
    expect(await login(db, code, tahsin, '4321', '2468')).toEqual({ memberId: tahsin });
    expect(await clearedBefore(db, flatId, zarif)).toEqual(new Set());
    await wrong(code, tahsin, 25);
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(true);   // after the reset Zarif may help again
    expect(await clears(tahsin)).toBe(3);
  });

  it('two clears at once: one row, count 20 once; a wrong try racing a clear never gives more than 4 tries', async () => {
    const { flatId, code, tahsin, zarif, nafis } = await flat();
    await wrong(code, tahsin, 25);
    const r = await Promise.all([clearLock(db, flatId, tahsin, zarif), clearLock(db, flatId, tahsin, nafis), login(db, code, tahsin, '0000', null)]);
    expect(r.slice(0, 2).filter(Boolean)).toHaveLength(1);
    const s = await state(tahsin);
    expect([20, 21]).toContain(s.n);
    expect(await clears(tahsin)).toBe(1);
  });

  it('money, roles, meals and months are untouched; nothing holds a PIN', async () => {
    const { flatId, code, tahsin, zarif } = await flat();
    expect(await addEntry(db, flatId, { memberId: tahsin, role: 'member' }, { type: 'bazar', amount: 245000, date: today, note: null, paidBy: tahsin, memberId: null, split: null, selected: [] }, today)).toBe('ok');
    const snap = async () => ({
      ledger: await db(`select id, amount_poisha, status, paid_by_member_id from ledger where flat_id = $1 order by id`, [flatId]),
      members: await db(`select id, role, name, joined_on, left_on, pin_hash from members where flat_id = $1 order by name`, [flatId]),
      months: await db(`select month, version, closed_at from months where flat_id = $1 order by month`, [flatId]),
      meals: await db(`select count(*)::int as n from meal_changes where flat_id = $1`, [flatId]),
    });
    await wrong(code, tahsin, 25);
    const was = await snap();
    expect(await clearLock(db, flatId, tahsin, zarif)).toBe(true);
    expect(await snap()).toEqual(was);
    const everything = JSON.stringify(await db(`select after, before from audit_log where flat_id = $1`, [flatId]));
    for (const pin of ['5827', '9024', '0000', '1234']) expect(everything).not.toContain(pin);
    expect((await listMembers(db, flatId)).find(m => m.id === tahsin)).toMatchObject({ locked: false, collector: false });
  });

  it('both languages say what a clear does', () => {
    for (const lang of ['en', 'bn'] as const) {
      const t = getDictionary(lang);
      expect(t.app.clearLockLead).toContain('4');
      expect(t.app.clearLockLead).not.toMatch(/for good|পুরোপুরি/);   // a cleared lock can be cleared again: never promise a final lock
      expect(t.app.errors.lockedForGood).toContain('4');
      expect(t.app.lockedTitle).toContain('{name}');
      expect(t.app.lockCleared).toContain('{name}');
      expect(t.app.lockedBadgeTeam).not.toBe(t.app.lockedBadge);
      expect(t.app.clearedBeforeLead).toBeTruthy();
      expect(t.app.errors.clearedBefore).toBeTruthy();
      expect(t.meals.lockClearedHistory).toBeTruthy();
    }
  });
});
