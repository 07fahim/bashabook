import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { clearLock, createFlat, flatByCode, login, resetPin } from './auth';
import { saveMeal } from './meals-db';
import { addEntry, confirmEntry, openMonth, type NewEntry } from './money-db';
import { listNotices, markNoticesSeen, noticeCount } from './notices';

// The bell (spec 2026-10-15): one query over rows the app already writes, addressed to one person; opening marks seen,
// pending rows stay until resolved.
const today = '2026-10-09';
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount' | 'date'>): NewEntry => ({ note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
async function flat() {
  await migrate();
  const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today, lang: 'bn' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const members = (await flatByCode(db, code))!.members;
  const id = (name: string) => members.find(m => m.name === name)!.id;
  const tahsin = id('Tahsin'), zarif = id('Zarif');
  await login(db, code, tahsin, '5678', null); await login(db, code, zarif, '9999', null);
  await openMonth(db, flatId, '2026-10-01');
  // the flat was created a moment ago: push everyone's seen mark back so the rows below count as new
  await db(`update members set notices_seen_at = now() - interval '1 hour' where flat_id = $1`, [flatId]);
  const boss = { memberId, role: 'manager' as const }, member = (m: string) => ({ memberId: m, role: 'member' as const });
  return { flatId, nafis: memberId, code, tahsin, zarif, boss, member };
}
const kinds = (n: { kind: string }[]) => n.map(x => x.kind);

describe('notices', { timeout: 60000 }, () => {
  it('a deposit waits for the collector, not for the payer, and leaves once confirmed', async () => {
    const { flatId, nafis, tahsin, boss, member } = await flat();
    expect(await addEntry(db, flatId, member(tahsin), e({ type: 'deposit', amount: 50000, date: today, memberId: tahsin }))).toBe('ok');
    expect(kinds(await listNotices(db, flatId, nafis, true))).toEqual(['paid']);
    expect(await noticeCount(db, flatId, nafis, true)).toBe(1);
    expect(await listNotices(db, flatId, tahsin, false)).toEqual([]);
    const [{ id }] = await db<{ id: string }>(`select id from ledger where flat_id = $1 and status = 'pending'`, [flatId]);
    await confirmEntry(db, flatId, boss, id);
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
  });

  it('a payout waits for its receiver only', async () => {
    const { flatId, nafis, tahsin, zarif, boss } = await flat();
    expect(await addEntry(db, flatId, boss, e({ type: 'payout', amount: 20000, date: today, memberId: tahsin }))).toBe('ok');
    expect(kinds(await listNotices(db, flatId, tahsin, false))).toEqual(['paid']);
    expect(await listNotices(db, flatId, zarif, false)).toEqual([]);
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
  });

  it('someone changing my meal is mine; my own tap is not', async () => {
    const { flatId, nafis, tahsin } = await flat();
    await saveMeal(db, flatId, nafis, { memberId: tahsin, date: '2026-10-10', meal: 'd', count: 0, guests: 0 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-11', meal: 'l', count: 0, guests: 0 }, false);
    const mine = await listNotices(db, flatId, tahsin, false);
    expect(mine.map(n => [n.kind, n.actor, n.date, n.meal])).toEqual([['meal', 'Nafis', '2026-10-10', 'd']]);
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
  });

  it('a PIN reset and a lock clear are mine; unread until I open the bell, pending rows stay', async () => {
    const { flatId, nafis, code, tahsin, zarif, boss } = await flat();
    expect(await resetPin(db, flatId, tahsin, '4321', { memberId: nafis })).toBe(true);
    for (let i = 0; i < 25; i++) { await login(db, code, zarif, '0000', null); await db(`update members set locked_until = null where id = $1 and locked_until <> 'infinity'`, [zarif]); }
    expect(await clearLock(db, flatId, zarif, tahsin)).toBe(true);
    expect(await addEntry(db, flatId, boss, e({ type: 'payout', amount: 20000, date: today, memberId: zarif }))).toBe('ok');
    expect(kinds(await listNotices(db, flatId, tahsin, false))).toEqual(['account']);
    expect(await noticeCount(db, flatId, zarif, false)).toBe(2);
    await markNoticesSeen(db, flatId, zarif);
    expect(await noticeCount(db, flatId, zarif, false)).toBe(0);
    expect(kinds(await listNotices(db, flatId, zarif, false)).sort()).toEqual(['account', 'paid']);   // read is not resolved
  });

  it('a finished month still open is the collector\'s to close', async () => {
    const { flatId, nafis, tahsin } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    expect(kinds(await listNotices(db, flatId, nafis, true))).toEqual(['closeMonth']);
    expect(await listNotices(db, flatId, tahsin, false)).toEqual([]);
  });

  it('another flat sees nothing', async () => {
    const { flatId, nafis, tahsin, member } = await flat();
    const other = await createFlat(db, { flatName: 'Flat 9C', name: 'Rafi', pin: '1111', others: [], today, lang: 'en' });
    expect(await addEntry(db, flatId, member(tahsin), e({ type: 'deposit', amount: 50000, date: today, memberId: tahsin }))).toBe('ok');
    expect(await listNotices(db, other.flatId, other.memberId, true)).toEqual([]);
    expect(await noticeCount(db, flatId, nafis, true)).toBe(1);
  });
});
