import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { saveMeal } from './meals-db';
import { addEntry, addRoom, loadMonth, openMonth, setRoom, type NewEntry } from './money-db';
import { addCorrection, closeMonth, closeInfo, coverGap, openFrom, parseCash } from './close';
import { allocate } from './money';

const e = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>): NewEntry =>
  ({ date: '2026-09-05', note: null, paidBy: null, memberId: null, split: null, selected: [], ...p });

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: '2026-09-01', lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  const version = async (m: string) => (await db<{ v: number }>(`select version as v from months where flat_id = $1 and month = $2`, [f.flatId, m]))[0]?.v;
  return { flatId: f.flatId, ids, nafis, version };
}

describe('month triggers', { timeout: 30000 }, () => {
  it('every write bumps its month, settings bump every open month, a closed month refuses writes', async () => {
    const { flatId, ids, nafis, version } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    const v0 = await version('2026-09-01');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000 }))).toBe('ok');
    expect(await version('2026-09-01')).toBe(v0 + 1);
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-06', meal: 'l', count: 0, guests: 0 }, false);
    expect(await version('2026-09-01')).toBe(v0 + 2);
    await db(`update flats set weight_b = 60 where id = $1`, [flatId]);
    expect(await version('2026-09-01')).toBe(v0 + 3);
    const room = await addRoom(db, flatId, nafis, 'Front', 0);
    expect(await setRoom(db, flatId, nafis, ids.Tahsin, room)).toBe(true);
    expect(await version('2026-09-01')).toBe(v0 + 5);   // a new room and a room assignment
    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    await expect(addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 100 }))).rejects.toThrow('month_closed');
    await expect(saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-07', meal: 'l', count: 0, guests: 0 }, false)).rejects.toThrow('month_closed');
    expect(await db(`select 1 from ledger where flat_id = $1 and amount_poisha = 100`, [flatId])).toEqual([]);
    // a month with no row yet can't be closed: writes into it need no lock
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-12-02', meal: 'l', count: 0, guests: 0 }, false);
  });

  it('an adjustment must name who it moves to and the month it corrects', async () => {
    const { flatId, ids, nafis, version } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    await openMonth(db, flatId, '2026-10-01');
    // moves and for_month both missing: violates only ledger_adjustment_check (member_id is set, so ledger_check2 is happy)
    await expect(db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, date, status, created_by)
      values ($1, '2026-09-01', 'adjustment', 100, $2, '2026-09-05', 'ok', $3)`, [flatId, ids.Tahsin, nafis.memberId]))
      .rejects.toThrow('ledger_adjustment_check');

    await db(`update months set status = 'closed' where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    const vClosed = await version('2026-09-01');
    const vOpen = await version('2026-10-01');
    // a real Kind B correction: posted into the open month, correcting the now-closed one
    await db(`insert into ledger (flat_id, month, type, amount_poisha, member_id, moves, for_month, date, status, created_by)
      values ($1, '2026-10-01', 'adjustment', 100, $2, $3, '2026-09-01', '2026-10-05', 'ok', $4)`,
      [flatId, ids.Tahsin, ids.Zarif, nafis.memberId]);
    expect(await version('2026-10-01')).toBe(vOpen + 1);
    expect(await version('2026-09-01')).toBe(vClosed);
  });
});

describe('loading months', { timeout: 30000 }, () => {
  it('a closed month comes from its snapshot; the next month opens with it, applied once', async () => {
    const { flatId, ids } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    await db(`update months set status = 'closed', closing_fund = 5000, meal_rate = 4000 where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    for (const [name, bal] of [['Nafis', 7000], ['Tahsin', -3000], ['Zarif', 1000]] as const) {
      await db(`insert into month_balances (flat_id, month, member_id, weighted_meals, days_present, opening, paid_in, food_cost, bill_share, payouts, adjustments, balance)
        values ($1, '2026-09-01', $2, 100, 30, 0, 0, 0, 0, 0, 0, $3)`, [flatId, ids[name], bal]);
    }
    const sep = await loadMonth(db, flatId, '2026-09-01', '2026-10-05');
    expect(sep.info?.status).toBe('closed');
    expect(sep.result.fund).toBe(5000);
    expect(sep.result.perMember.find(p => p.id === ids.Tahsin)!.balance).toBe(-3000);
    const oct = await loadMonth(db, flatId, '2026-10-01', '2026-10-05');
    expect(oct.carriedFrom).toBe('2026-09-01');
    expect(oct.earlierOpen).toBeNull();
    expect(oct.result.perMember.find(p => p.id === ids.Tahsin)!.opening).toBe(-3000);
    expect(oct.result.fund).toBe(5000);
    expect(oct.result.invariantOk).toBe(true);
    // loading again changes nothing: the opening is read, never copied
    expect((await loadMonth(db, flatId, '2026-10-01', '2026-10-05')).result.fund).toBe(5000);
  });

  it('while an earlier month is open the new month has no opening', async () => {
    const { flatId } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    const oct = await loadMonth(db, flatId, '2026-10-01', '2026-10-05');
    expect(oct.earlierOpen).toBe('2026-09-01');
    expect(oct.carriedFrom).toBeNull();
    expect(oct.result.fund).toBe(0);
  });
});

const cash = (t: number) => ({ cash: t, bkash: 0, nagad: 0, bank: 0 });

describe('closing a month', { timeout: 30000 }, () => {
  it('closes only with matching cash, on or after the 1st, by the collector, oldest month first', async () => {
    const { flatId, ids, nafis } = await flat();
    expect(await addEntry(db, flatId, nafis, e({ type: 'deposit', amount: 300000, memberId: ids.Tahsin }))).toBe('ok');
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 120000 }))).toBe('ok');   // fund 1,800
    const tahsin = { memberId: ids.Tahsin, role: 'member' as const };
    expect((await closeMonth(db, flatId, tahsin, '2026-09-01', '2026-10-01', cash(180000))).result).toBe('notCollector');
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-09-30', cash(180000))).result).toBe('early');
    const bad = await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(179900));
    expect([bad.result, bad.expected, bad.actual]).toEqual(['cash', 180000, 179900]);
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', { cash: 100000, bkash: 50000, nagad: 30000, bank: 0 })).result).toBe('ok');
    const [m] = await db<{ status: string; cash: { actual: number; expected: number; by: string } }>(`select status, cash from months where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    expect([m.status, m.cash.actual, m.cash.expected, m.cash.by]).toEqual(['closed', 180000, 180000, ids.Nafis]);
    const bal = await db<{ s: string }>(`select sum(balance)::text as s from month_balances where flat_id = $1 and month = '2026-09-01'`, [flatId]);
    expect(Number(bal[0].s)).toBe(180000);   // Σ balances = frozen fund
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(180000))).result).toBe('closed');
    expect(await db(`select 1 from audit_log where flat_id = $1 and entity = 'months'`, [flatId])).toHaveLength(1);
  });

  it('covers a negative fund with the collector’s own deposit, once for the same month state', async () => {
    const { flatId, nafis } = await flat();
    expect(await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 50000 }))).toBe('ok');   // flat money, none held: fund −500
    const before = await loadMonth(db, flatId, '2026-09-01', '2026-10-02');
    expect(before.result.fund).toBe(-50000);
    const bal = (m: typeof before) => m.result.perMember.find(p => p.id === nafis.memberId)!.balance;
    expect(await coverGap(db, flatId, { ...nafis, role: 'member' }, '2026-10-02', 'x')).toBe('bad');
    // two tabs at once, no change in between: one deposit
    expect(await Promise.all([coverGap(db, flatId, nafis, '2026-10-02', 'gap'), coverGap(db, flatId, nafis, '2026-10-02', 'gap')])).toEqual(['ok', 'ok']);
    expect(await coverGap(db, flatId, nafis, '2026-10-02', 'gap')).toBe('ok');   // a later tap: nothing left to cover
    const after = await loadMonth(db, flatId, '2026-09-01', '2026-10-02');
    expect([after.result.fund, bal(after) - bal(before)]).toEqual([0, 50000]);
    expect(await db(`select 1 from ledger where flat_id = $1 and type = 'deposit'`, [flatId])).toHaveLength(1);
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-02', cash(0))).result).toBe('ok');
  });

  it('refuses with a pending entry, and while an older month is open', async () => {
    const { flatId, ids, nafis } = await flat();
    await addEntry(db, flatId, { memberId: ids.Tahsin, role: 'member' }, e({ type: 'deposit', amount: 5000, memberId: ids.Tahsin }));
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(0))).result).toBe('pending');
    await openMonth(db, flatId, '2026-11-01');   // October has no row: a gap must not let November jump September
    expect((await closeMonth(db, flatId, nafis, '2026-11-01', '2026-12-01', cash(0))).result).toBe('order');
  });

  it('a change after the version was read makes the close write nothing', async () => {
    const { flatId, ids, nafis } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    // simulate a meal change landing between the read and the close: bump the version by hand after loading
    const r = await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(0), async () => {
      await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-09', meal: 'l', count: 0, guests: 0 }, false);
    });
    expect(r.result).toBe('changed');
    expect(await db(`select 1 from month_balances where flat_id = $1`, [flatId])).toEqual([]);
  });

  it('two months: carried exactly once, settled to zero, the collector included', async () => {
    const { flatId, ids, nafis } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 90000, paidBy: ids.Tahsin }));   // Tahsin +600, everyone -300
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(0))).result).toBe('ok');
    const sep = Object.fromEntries((await db<{ id: string; b: number }>(`select member_id as id, balance::int as b from month_balances where flat_id = $1`, [flatId])).map(r => [r.id, r.b]));
    expect([sep[ids.Nafis], sep[ids.Tahsin], sep[ids.Zarif]]).toEqual([-30000, 60000, -30000]);
    // October: settle exactly the September lines, with no new costs
    const oct = (p: Partial<NewEntry> & Pick<NewEntry, 'type' | 'amount'>) => addEntry(db, flatId, nafis, e({ date: '2026-10-03', ...p }));
    await oct({ type: 'deposit', amount: 30000, memberId: ids.Zarif });
    await oct({ type: 'deposit', amount: 30000, memberId: ids.Nafis });   // the collector puts their share into flat money
    await oct({ type: 'payout', amount: 60000, memberId: ids.Tahsin });
    await db(`update ledger set status = 'ok' where flat_id = $1 and status = 'pending'`, [flatId]);   // Tahsin confirmed the money
    const mo = await loadMonth(db, flatId, '2026-10-01', '2026-10-04');
    expect(mo.result.perMember.every(p => p.balance === 0)).toBe(true);
    expect(mo.result.fund).toBe(0);
    expect(mo.result.perMember.find(p => p.id === ids.Tahsin)!.opening).toBe(60000);   // carried once
    expect((await closeMonth(db, flatId, nafis, '2026-10-01', '2026-11-01', cash(0))).result).toBe('ok');
  });

  it('cash boxes: empty is 0, negative or text is refused', () => {
    expect(parseCash({ cash: '1,200.50', bkash: '', nagad: '০', bank: '0' })).toEqual({ cash: 120050, bkash: 0, nagad: 0, bank: 0 });
    expect(parseCash({ cash: '-5', bkash: '', nagad: '', bank: '' })).toBeNull();
    expect(parseCash({ cash: 'abc', bkash: '', nagad: '', bank: '' })).toBeNull();
    expect(parseCash({ cash: '৳0', bkash: '0,000', nagad: ' 0.00 ', bank: '' })).toEqual({ cash: 0, bkash: 0, nagad: 0, bank: 0 });
  });

  it('after a close, meals and money for that month are closed and the open window starts after it', async () => {
    const { flatId, ids, nafis } = await flat();
    await openMonth(db, flatId, '2026-09-01');
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-05', cash(0))).result).toBe('ok');
    expect(await openFrom(db, flatId, '2026-10-05')).toBe('2026-10-01');   // editFrom alone would say 1 September
    await expect(saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-09', meal: 'l', count: 0, guests: 0 }, false)).rejects.toThrow('month_closed');
    expect(await closeInfo(db, flatId, '2026-10-05')).toBeNull();
  });
});

describe('corrections', { timeout: 30000 }, () => {
  async function closedSeptember() {
    const t = await flat();
    await addEntry(db, t.flatId, t.nafis, e({ type: 'bazar', amount: 90000, paidBy: t.ids.Tahsin }));   // out of pocket: fund stays 0
    expect((await closeMonth(db, t.flatId, t.nafis, '2026-09-01', '2026-10-02', cash(0))).result).toBe('ok');
    return t;
  }
  const sumBalances = (r: { perMember: { balance: number }[] }) => r.perMember.reduce((a, p) => a + p.balance, 0);

  it('a forgotten bazar is split by September frozen meals, lands in October, and leaves September and the fund alone', async () => {
    const { flatId, ids, nafis } = await closedSeptember();
    const before = await db(`select * from month_balances where flat_id = $1 order by member_id`, [flatId]);
    const id = randomUUID();
    expect(await addCorrection(db, flatId, nafis, { id, kind: 'bazar', forMonth: '2026-09-01', amount: 30000, paidBy: ids.Zarif, note: 'egg receipt' }, '2026-10-02')).toBe('ok');
    expect(await addCorrection(db, flatId, nafis, { id, kind: 'bazar', forMonth: '2026-09-01', amount: 30000, paidBy: ids.Zarif, note: 'egg receipt' }, '2026-10-02')).toBe('ok');   // retry
    expect(await db(`select 1 from ledger where flat_id = $1 and for_month = '2026-09-01'`, [flatId])).toHaveLength(1);
    expect(await db(`select * from month_balances where flat_id = $1 order by member_id`, [flatId])).toEqual(before);
    const oct = await loadMonth(db, flatId, '2026-10-01', '2026-10-02');
    const z = oct.result.perMember.find(p => p.id === ids.Zarif)!;
    expect(z.paidIn).toBe(30000);
    expect(oct.result.perMember.reduce((a, p) => a + p.foodCost, 0)).toBe(30000);
    expect(oct.result.fund).toBe(0);
    expect(oct.result.invariantOk).toBe(true);
    expect(sumBalances(oct.result)).toBe(oct.result.fund);
  });

  it('a move between two people, and the rules', async () => {
    const { flatId, ids, nafis } = await closedSeptember();
    const move = { id: randomUUID(), kind: 'move' as const, forMonth: '2026-09-01', amount: 2500, from: ids.Tahsin, to: ids.Zarif, note: 'wrong payer' };
    expect(await addCorrection(db, flatId, nafis, move, '2026-10-02')).toBe('ok');
    const oct = await loadMonth(db, flatId, '2026-10-01', '2026-10-02');
    expect(oct.result.perMember.find(p => p.id === ids.Zarif)!.adjustments).toBe(2500);
    expect(oct.result.invariantOk).toBe(true);
    expect(sumBalances(oct.result)).toBe(oct.result.fund);
    expect(await addCorrection(db, flatId, nafis, { ...move, id: randomUUID(), note: ' ' }, '2026-10-02')).toBe('bad');
    expect(await addCorrection(db, flatId, { memberId: ids.Tahsin, role: 'member' }, { ...move, id: randomUUID() }, '2026-10-02')).toBe('bad');
    expect(await addCorrection(db, flatId, nafis, { ...move, id: randomUUID(), forMonth: '2026-10-01' }, '2026-10-02')).toBe('month');   // not closed
    // a cost fixed later always has a person who paid it: corrections never touch flat money
    const noPayer = { id: randomUUID(), kind: 'bazar' as const, forMonth: '2026-09-01', amount: 100, paidBy: null as unknown as string, note: 'x' };
    expect(await addCorrection(db, flatId, nafis, noPayer, '2026-10-02')).toBe('bad');
    expect(await addCorrection(db, flatId, nafis, { ...noPayer, paidBy: '' }, '2026-10-02')).toBe('bad');
    expect(await db(`select 1 from ledger where flat_id = $1 and for_month is not null`, [flatId])).toHaveLength(1);
  });

  it('someone who moved out keeps their balance until it is paid, a part payment leaves the rest', async () => {
    const { flatId, ids, nafis } = await flat();
    await addEntry(db, flatId, nafis, e({ type: 'bazar', amount: 300000, paidBy: ids.Zarif }));   // Zarif +2,250: he is here 20 of September's 30 days, so his share is 750
    await db(`update members set left_on = '2026-09-20' where id = $1`, [ids.Zarif]);
    expect((await closeMonth(db, flatId, nafis, '2026-09-01', '2026-10-01', cash(0))).result).toBe('ok');
    const zarif = async () => (await loadMonth(db, flatId, '2026-10-01', '2026-10-05')).result.perMember.find(p => p.id === ids.Zarif);
    expect((await zarif())!.balance).toBe(225000);
    await db(`insert into months (flat_id, month) values ($1, '2026-10-01') on conflict do nothing`, [flatId]);
    expect(await addEntry(db, flatId, nafis, e({ type: 'payout', amount: 80000, memberId: ids.Zarif, date: '2026-10-05' }))).toBe('ok');   // counts at once: they moved out
    expect((await zarif())!.balance).toBe(145000);   // still listed with the rest owed
    // a forgotten September bazar still charges Zarif his frozen share, next to his opening
    expect(await addCorrection(db, flatId, nafis, { id: randomUUID(), kind: 'bazar', forMonth: '2026-09-01', amount: 30001, paidBy: ids.Tahsin, note: 'late receipt' }, '2026-10-05')).toBe('ok');
    const sep = await db<{ id: string; meals: number }>(`select member_id as id, weighted_meals as meals from month_balances where flat_id = $1 and month = '2026-09-01' and weighted_meals > 0 order by member_id`, [flatId]);
    const share = allocate(30001, sep.map(s => s.meals))![sep.findIndex(s => s.id === ids.Zarif)];
    expect(share).toBeGreaterThan(0);
    const oct = (await loadMonth(db, flatId, '2026-10-01', '2026-10-05')).result;
    const z = oct.perMember.find(p => p.id === ids.Zarif)!;
    expect([z.opening, z.foodCost, z.balance]).toEqual([225000, share, 145000 - share]);
    expect(oct.invariantOk).toBe(true);
    expect(sumBalances(oct)).toBe(oct.fund);
  });

  it('a retried money entry with the same one-time id is recorded once', async () => {
    const { flatId, ids, nafis } = await flat();
    const id = randomUUID();
    for (let i = 0; i < 2; i++) expect(await addEntry(db, flatId, nafis, e({ id, type: 'deposit', amount: 7000, memberId: ids.Zarif }))).toBe('ok');
    expect(await db(`select 1 from ledger where id = $1`, [id])).toHaveLength(1);
  });
});
