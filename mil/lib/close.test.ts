import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { saveMeal } from './meals-db';
import { addEntry, addRoom, loadMonth, openMonth, setRoom, type NewEntry } from './money-db';
import { closeMonth, closeInfo, openFrom, parseCash } from './close';

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
