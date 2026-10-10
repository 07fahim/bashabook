import { describe, it, expect } from 'vitest';
import { allocate, foodSplit, monthBalances, settleLines, toPoisha, type LedgerRow, type MonthInput } from './money';

describe('allocate', () => {
  it('splits exactly with largest remainder, ties to lowest index', () => {
    expect(allocate(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
  });
  it('prorates by days: 31 vs 21 days of 310 taka', () => {
    expect(allocate(31000, [31, 21])).toEqual([18481, 12519]);
  });
  it('returns null when every weight is 0', () => {
    expect(allocate(500, [0, 0])).toBeNull();
  });
  it('refuses non-integers (e.g. amounts that arrived as strings or decimals)', () => {
    expect(() => allocate(10.5, [1, 1])).toThrow(TypeError);
    expect(() => allocate('100' as unknown as number, [1])).toThrow(TypeError);
  });
});

const row = (p: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'type' | 'amount'>): LedgerRow =>
  ({ paidBy: null, memberId: null, split: null, selected: [], status: 'ok', ...p });

const base = (over: Partial<MonthInput> = {}): MonthInput => ({
  memberIds: ['A', 'B', 'C'],
  opening: new Map(),
  openingFund: 0,
  weightedMeals: new Map([['A', 6000], ['B', 3000], ['C', 1000]]),
  daysPresent: new Map([['A', 31], ['B', 31], ['C', 31]]),
  roomOf: new Map([['A', 'R1'], ['B', 'R1'], ['C', 'R2']]),
  rooms: [{ id: 'R1', rentShare: 600000 }, { id: 'R2', rentShare: 400000 }],
  ledger: [],
  ...over,
});

const bal = (r: ReturnType<typeof monthBalances>) => Object.fromEntries(r.perMember.map(m => [m.id, m.balance]));

describe('monthBalances', () => {
  it('worked month: out-of-pocket bazar, fund-paid bills, selected laundry', () => {
    // Bazar 1,000 tk paid by A; weighted meals 60/30/10 -> food 600/300/100
    // Internet 300 tk equal, from fund -> 100 each; laundry 200 tk for B,C, from fund -> 100 each
    // Deposits B 500, C 300. Fund = 800 - 300 - 200 = 300 tk, which is owed to A.
    const r = monthBalances(base({ ledger: [
      row({ id: 'z1', type: 'bazar', amount: 100000, paidBy: 'A' }),
      row({ id: 'i1', type: 'bill', amount: 30000, split: 'equal' }),
      row({ id: 'w1', type: 'bill', amount: 20000, split: 'selected', selected: ['B', 'C'] }),
      row({ id: 'd1', type: 'deposit', amount: 50000, memberId: 'B' }),
      row({ id: 'd2', type: 'deposit', amount: 30000, memberId: 'C' }),
    ] }));
    expect(bal(r)).toEqual({ A: 30000, B: 0, C: 0 });
    expect(r.fund).toBe(30000);
    expect(r.mealRate).toBe(1000);   // 10.00 tk per weighted meal
    expect(r.invariantOk).toBe(true);
  });

  it('carries balances into the next month, where dues get settled', () => {
    // Month 1: A paid 1,000 tk bazar; meals 60/30/10 -> A +400, B -300, C -100, fund 0
    const m1 = monthBalances(base({ ledger: [row({ id: 'z1', type: 'bazar', amount: 100000, paidBy: 'A' })] }));
    expect(bal(m1)).toEqual({ A: 40000, B: -30000, C: -10000 });
    // Month 2: no meals or bills yet; B and C pay their dues, A is paid out
    const m2 = monthBalances(base({
      opening: new Map(m1.perMember.map(m => [m.id, m.balance])),
      openingFund: m1.fund,
      ledger: [
        row({ id: 'd1', type: 'deposit', amount: 30000, memberId: 'B' }),
        row({ id: 'd2', type: 'deposit', amount: 10000, memberId: 'C' }),
        row({ id: 'p1', type: 'payout', amount: 40000, memberId: 'A' }),
      ],
    }));
    expect(bal(m2)).toEqual({ A: 0, B: 0, C: 0 });
    expect(m2.fund).toBe(0);
    expect(m2.invariantOk).toBe(true);
  });

  it('rent by room: room shares first, then split inside each room', () => {
    const r = monthBalances(base({ ledger: [row({ id: 'r1', type: 'bill', amount: 1000000, split: 'room', paidBy: 'A' })] }));
    expect(r.perMember.map(m => m.billShare)).toEqual([300000, 300000, 400000]);
    expect(r.invariantOk).toBe(true);
  });

  it('ignores pending rows; payouts settle a balance', () => {
    const r = monthBalances(base({ ledger: [
      row({ id: 'z1', type: 'bazar', amount: 100000, paidBy: 'A' }),
      row({ id: 'd1', type: 'deposit', amount: 70000, memberId: 'B' }),
      row({ id: 'd2', type: 'deposit', amount: 30000, memberId: 'C' }),
      row({ id: 'p1', type: 'payout', amount: 40000, memberId: 'A' }),
      row({ id: 'x', type: 'bazar', amount: 99999, paidBy: 'C', status: 'pending' }),
    ] }));
    expect(bal(r)).toEqual({ A: 0, B: 40000, C: 20000 });
    expect(r.fund).toBe(60000);
    expect(r.invariantOk).toBe(true);
  });

  it('blocks closing when bazar has no meals to split over', () => {
    const r = monthBalances(base({ weightedMeals: new Map(), ledger: [row({ id: 'z1', type: 'bazar', amount: 5000, paidBy: 'A' })] }));
    expect(r.invariantOk).toBe(false);
    expect(r.problems[0]).toMatch(/nobody to split/);
  });

  it('flags an empty room but ignores empty rooms with no rent share', () => {
    const allInR1 = new Map([['A', 'R1'], ['B', 'R1'], ['C', 'R1']]);
    const r = monthBalances(base({ roomOf: allInR1, ledger: [row({ id: 'r1', type: 'bill', amount: 1000000, split: 'room' })] }));
    expect(r.invariantOk).toBe(false);
    expect(r.problems[0]).toMatch(/empty room/);
    const ok = monthBalances(base({ roomOf: allInR1, rooms: [{ id: 'R1', rentShare: 600000 }, { id: 'R2', rentShare: 0 }], ledger: [row({ id: 'r1', type: 'bill', amount: 900000, split: 'room' })] }));
    expect(ok.problems).toEqual([]);
    expect(ok.perMember.map(m => m.billShare)).toEqual([300000, 300000, 300000]);
  });

  it('flags a present member with no room when rent is split by room', () => {
    const r = monthBalances(base({ roomOf: new Map([['A', 'R1'], ['B', null], ['C', 'R2']]), ledger: [row({ id: 'r1', type: 'bill', amount: 1000000, split: 'room' })] }));
    expect(r.invariantOk).toBe(false);
    expect(r.problems[0]).toMatch(/no room set for B/);
  });

  it('lets a tenant of a zero-share room pay no rent without a problem', () => {
    const r = monthBalances(base({ rooms: [{ id: 'R1', rentShare: 600000 }, { id: 'R2', rentShare: 0 }], ledger: [row({ id: 'r1', type: 'bill', amount: 600000, split: 'room' })] }));
    expect(r.problems).toEqual([]);
    expect(r.perMember.map(m => m.billShare)).toEqual([300000, 300000, 0]);
  });

  it('flags an opening balance that does not reach the fund', () => {
    const r = monthBalances(base({ opening: new Map([['X', -5000]]), openingFund: -5000 }));
    expect(r.invariantOk).toBe(false);
    expect(r.problems).toEqual(['balances differ from fund by 5000']);
  });

  it('reports unknown members instead of crashing', () => {
    const r = monthBalances(base({ ledger: [
      row({ id: 'd9', type: 'deposit', amount: 5000, memberId: 'X' }),
      row({ id: 'w1', type: 'bill', amount: 20000, split: 'selected', selected: ['B', 'X'] }),
    ] }));
    expect(r.invariantOk).toBe(false);
    expect(r.problems).toEqual(['d9: unknown member X', 'w1: unknown member X', 'balances differ from fund by 20000']);   // the unsplit laundry bill left the fund
  });
});

// Plan 5 stress tests: money moving between people is never a second expense.
// A is the collector. Each pair of ledgers must give the same balances and fund.
describe('money moving between people', () => {
  const same = (x: LedgerRow[], y: LedgerRow[]) => {
    const [rx, ry] = [monthBalances(base({ ledger: x })), monthBalances(base({ ledger: y }))];
    expect([rx.invariantOk, ry.invariantOk]).toEqual([true, true]);
    expect(bal(rx)).toEqual(bal(ry));
    expect(rx.fund).toBe(ry.fund);
    return rx;
  };
  const deposit = row({ id: 'd', type: 'deposit', amount: 1000000, memberId: 'B' });

  it('collector pays ৳5,000 personally, then is paid back from the fund', () => {
    const r = same(
      [deposit, row({ id: 'z', type: 'bazar', amount: 500000, paidBy: 'A' }), row({ id: 'p', type: 'payout', amount: 500000, memberId: 'A' })],
      [deposit, row({ id: 'z', type: 'bazar', amount: 500000, paidBy: null })],
    );
    expect(r.perMember.reduce((a, m) => a + m.foodCost, 0)).toBe(500000);   // the expense counts once
  });

  it('shopper gets ৳3,000, spends ৳2,450, returns ৳550 change', () => {
    const r = same(
      [deposit, row({ id: 'a', type: 'payout', amount: 300000, memberId: 'C' }), row({ id: 'z', type: 'bazar', amount: 245000, paidBy: 'C' }),
        row({ id: 'c', type: 'deposit', amount: 55000, memberId: 'C' })],
      [deposit, row({ id: 'z', type: 'bazar', amount: 245000, paidBy: null })],
    );
    expect(r.fund).toBe(1000000 - 245000);   // what the collector should hold
  });

  it('an unconfirmed handover changes nothing until the receiver confirms', () => {
    same([deposit, row({ id: 'a', type: 'payout', amount: 300000, memberId: 'C', status: 'pending' })], [deposit]);
  });
});


describe('per-row shares and taka input', () => {
  it('lists each person share of each row, adding up to the row', () => {
    const r = monthBalances(base({ ledger: [
      row({ id: 'z1', type: 'bazar', amount: 100000, paidBy: 'A' }),
      row({ id: 'w1', type: 'bill', amount: 20000, split: 'selected', selected: ['B', 'C'] }),
    ] }));
    expect(r.lines.filter(l => l.rowId === 'w1')).toEqual([{ rowId: 'w1', memberId: 'B', amount: 10000 }, { rowId: 'w1', memberId: 'C', amount: 10000 }]);
    expect(r.lines.filter(l => l.rowId === 'bazar').reduce((a, l) => a + l.amount, 0)).toBe(100000);
  });

  it('splits food cost into own and guest meals that add up exactly, at awkward totals too', () => {
    expect(foodSplit(81667, 2450, 200)).toEqual({ own: 75000, guests: 6667 });   // 81667 x 200 / 2450 = 6666.7
    expect(foodSplit(100001, 3, 1)).toEqual({ own: 66667, guests: 33334 });
    expect(foodSplit(0, 0, 0)).toEqual({ own: 0, guests: 0 });
    for (const [f, m, g] of [[99999, 7, 3], [1, 3, 1], [245000, 2450, 0]]) {
      const x = foodSplit(f, m, g);
      expect(x.own + x.guests).toBe(f);
    }
  });

  it('reads taka the way people type it', () => {
    expect(toPoisha('2450')).toBe(245000);
    expect(toPoisha('2,450.5')).toBe(245050);
    expect(toPoisha('৳ ২৪৫০')).toBe(245000);   // Bangla keyboard digits
    expect(toPoisha('0')).toBeNull();
    expect(toPoisha('-5')).toBeNull();
    expect(toPoisha('12.345')).toBeNull();
    expect(toPoisha('abc')).toBeNull();
    expect(toPoisha('10000001')).toBeNull();   // over ৳1,00,00,000 is a typo
  });
});

describe('corrections and settlement', () => {
  const base = { opening: new Map<string, number>(), openingFund: 0, daysPresent: new Map([['A', 30], ['B', 30]]),
    weightedMeals: new Map([['A', 1000], ['B', 1000]]), roomOf: new Map(), rooms: [] };
  const row = (p: Partial<LedgerRow> & Pick<LedgerRow, 'id' | 'type' | 'amount'>): LedgerRow =>
    ({ paidBy: null, memberId: null, split: null, selected: [], status: 'ok', ...p });

  it('a correction bazar is split by its frozen weights, stays out of the meal rate, and leaves the fund alone', () => {
    const r = monthBalances({ ...base, memberIds: ['A', 'B', 'C'], ledger: [
      row({ id: 'x', type: 'bazar', amount: 30000, paidBy: 'A', weights: [['A', 100], ['C', 200]] }),
    ] });
    const by = Object.fromEntries(r.perMember.map(p => [p.id, p]));
    expect(by.A.paidIn).toBe(30000);
    expect([by.A.foodCost, by.C.foodCost, by.B.foodCost]).toEqual([10000, 20000, 0]);
    expect(r.fund).toBe(0);
    expect(r.mealRate).toBe(0);
    expect(r.invariantOk).toBe(true);
  });

  it('an adjustment moves money between two people and keeps the invariant', () => {
    const r = monthBalances({ ...base, memberIds: ['A', 'B'], ledger: [row({ id: 'm', type: 'adjustment', amount: 2500, memberId: 'A', moves: 'B' })] });
    const by = Object.fromEntries(r.perMember.map(p => [p.id, p]));
    expect([by.A.adjustments, by.B.adjustments, by.A.balance, by.B.balance, r.fund]).toEqual([-2500, 2500, -2500, 2500, 0]);
    expect(r.invariantOk).toBe(true);
  });

  it('settlement lines are the balances themselves', () => {
    const per = [{ id: 'N', balance: -1234 }, { id: 'A', balance: -85037 }, { id: 'B', balance: 86271 }, { id: 'C', balance: 0 }]
      .map(p => ({ opening: 0, paidIn: 0, foodCost: 0, billShare: 0, payouts: 0, adjustments: 0, ...p }));
    expect(settleLines(per, 'N')).toEqual([
      { id: 'N', amount: 1234, kind: 'collectorAdds' }, { id: 'A', amount: 85037, kind: 'pays' }, { id: 'B', amount: 86271, kind: 'gets' },
    ]);
  });
});
