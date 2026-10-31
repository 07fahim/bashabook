import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { bringBack, clearLock, createFlat, flatByCode, login, renameMember, resetPin, setLeaving } from './auth';
import { acceptHandover, flatMoney, offerHandover } from './handover';
import { saveMeal } from './meals-db';
import { addEntry, confirmEntry, openMonth, rejectEntry, type NewEntry } from './money-db';
import { listNotices, markNoticesSeen, noticeCount } from './notices';
import { addDays, todayDhaka } from './meals';

// The bell (spec 2026-10-15): one query over rows the app already writes, addressed to one person; opening marks seen,
// pending rows stay until resolved.
// the current month on the real clock: the month-to-close notice reads the database clock, so a fixed month turns into
// a finished one (and an extra notice) once the calendar passes it
const ym = todayDhaka().slice(0, 7), prev = `${addDays(`${ym}-01`, -1).slice(0, 7)}-01`;
const today = `${ym}-01`;   // never after the real date: a handover needs someone already moved in
const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount' | 'date'>): NewEntry => ({ note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });
async function flat() {
  await migrate();
  const { flatId, memberId } = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today, lang: 'bn' });
  const [{ join_code: code }] = await db<{ join_code: string }>(`select join_code from flats where id = $1`, [flatId]);
  const members = (await flatByCode(db, code))!.members;
  const id = (name: string) => members.find(m => m.name === name)!.id;
  const tahsin = id('Tahsin'), zarif = id('Zarif');
  await login(db, code, tahsin, '5827', null); await login(db, code, zarif, '9024', null);
  await openMonth(db, flatId, `${ym}-01`);
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

  it('That is not right tells the writer who said it, and nobody else', async () => {
    const { flatId, nafis, tahsin, boss, member } = await flat();
    expect(await addEntry(db, flatId, boss, e({ type: 'payout', amount: 30000, date: today, memberId: tahsin }))).toBe('ok');
    const [{ id }] = await db<{ id: string }>(`select id from ledger where flat_id = $1 and status = 'pending'`, [flatId]);
    expect(await rejectEntry(db, flatId, member(tahsin), id)).toBe(nafis);
    const [n] = await listNotices(db, flatId, nafis, true);
    expect([n.kind, n.actor, n.amount, n.date, n.pending]).toEqual(['rejected', 'Tahsin', 30000, today, false]);
    expect(await noticeCount(db, flatId, nafis, true)).toBe(1);
    expect(await listNotices(db, flatId, tahsin, false)).toEqual([]);
  });

  it('a payout waits for its receiver only', async () => {
    const { flatId, nafis, tahsin, zarif, boss } = await flat();
    expect(await addEntry(db, flatId, boss, e({ type: 'payout', amount: 20000, date: today, memberId: tahsin }))).toBe('ok');
    expect(kinds(await listNotices(db, flatId, tahsin, false))).toEqual(['paid']);
    expect(await listNotices(db, flatId, zarif, false)).toEqual([]);
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
  });

  it('money the collector wrote for me is mine, named by who wrote it; never in the writer’s own bell', async () => {
    const { flatId, nafis, tahsin, boss } = await flat();
    expect(await addEntry(db, flatId, boss, e({ type: 'deposit', amount: 20000, date: today, memberId: tahsin }))).toBe('ok');   // Money received from Tahsin
    expect(await addEntry(db, flatId, boss, e({ type: 'payout', amount: 5000, date: today, memberId: tahsin }))).toBe('ok');    // Give money to Tahsin
    const mine = await listNotices(db, flatId, tahsin, false);
    expect(mine).toHaveLength(2);
    expect(mine.find(n => n.detail?.type === 'deposit')).toMatchObject({ kind: 'paid', actor: 'Nafis', amount: 20000, detail: { gave: true } });
    expect(mine.find(n => n.detail?.type === 'payout')).toMatchObject({ kind: 'paid', actor: 'Nafis', amount: 5000, detail: { gave: false } });
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
  });

  it('someone changing my meal is mine; my own tap is not', async () => {
    const { flatId, nafis, tahsin } = await flat();
    await saveMeal(db, flatId, nafis, { memberId: tahsin, date: `${ym}-02`, meal: 'd', count: 0, guests: 0 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: `${ym}-03`, meal: 'l', count: 0, guests: 0 }, false);
    const mine = await listNotices(db, flatId, tahsin, false);
    expect(mine.map(n => [n.kind, n.actor, n.date, n.meal])).toEqual([['meal', 'Nafis', `${ym}-02`, 'd']]);
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
    await openMonth(db, flatId, prev);
    expect(kinds(await listNotices(db, flatId, nafis, true))).toEqual(['closeMonth']);
    expect(await listNotices(db, flatId, tahsin, false)).toEqual([]);
  });

  it('a handover: the offer goes to the receiver, the answer to the old collector, nothing to a bystander', async () => {
    const { flatId, nafis, tahsin, zarif, boss } = await flat();
    expect(await offerHandover(db, flatId, boss, tahsin, await flatMoney(db, flatId, today), today)).toBe('ok');
    expect(kinds(await listNotices(db, flatId, tahsin, false))).toEqual(['handover']);
    expect(await listNotices(db, flatId, zarif, false)).toEqual([]);
    expect(await listNotices(db, flatId, nafis, true)).toEqual([]);
    const [{ id }] = await db<{ id: string }>(`select id from handovers where flat_id = $1 and status = 'offered'`, [flatId]);
    expect(await acceptHandover(db, flatId, tahsin, id)).toBe('ok');
    expect(await listNotices(db, flatId, tahsin, true)).toEqual([]);
    const done = await listNotices(db, flatId, nafis, false);
    expect(done.map(n => [n.kind, n.actor, n.detail, n.pending])).toEqual([['handoverDone', 'Tahsin', { status: 'accepted' }, false]]);
  });

  it('name, last day (set and taken back), brought back, a team PIN reset; newest first', async () => {
    const { flatId, nafis, tahsin } = await flat();
    expect(await renameMember(db, flatId, nafis, tahsin, 'Tahsin Ahmed')).toBe('ok');
    expect(await setLeaving(db, flatId, nafis, tahsin, `${ym}-12`, today)).toBe('ok');
    expect(await setLeaving(db, flatId, nafis, tahsin, null, today)).toBe('ok');
    expect(await setLeaving(db, flatId, nafis, tahsin, `${ym}-02`, today)).toBe('ok');
    expect(await bringBack(db, flatId, nafis, tahsin, `${ym}-04`, `${ym}-01`)).toBe('ok');   // two days after the last day
    expect(await resetPin(db, flatId, nafis, '2468', { admin: 'fahim', reason: 'phone check' })).toBe(true);
    const mine = await listNotices(db, flatId, tahsin, false);
    expect(mine.map(n => [n.kind, n.actor, Object.keys(n.detail!)[0]])).toEqual([
      ['account', 'Nafis', 'back'], ['account', 'Nafis', 'left'], ['account', 'Nafis', 'left'], ['account', 'Nafis', 'left'], ['account', 'Nafis', 'rename']]);
    expect(mine[1].detail).toEqual({ left: `${ym}-02` });
    expect(mine[2].detail).toEqual({ left: null });
    const boss = await listNotices(db, flatId, nafis, true);
    expect(boss.map(n => [n.kind, n.actor, 'pinReset' in n.detail!])).toEqual([['account', null, true]]);
  });

  it('another flat sees nothing', async () => {
    const { flatId, nafis, tahsin, member } = await flat();
    const other = await createFlat(db, { flatName: 'Flat 9C', name: 'Rafi', pin: '1111', others: [], today, lang: 'en' });
    expect(await addEntry(db, flatId, member(tahsin), e({ type: 'deposit', amount: 50000, date: today, memberId: tahsin }))).toBe('ok');
    expect(await listNotices(db, other.flatId, other.memberId, true)).toEqual([]);
    expect(await noticeCount(db, flatId, nafis, true)).toBe(1);
  });
});
