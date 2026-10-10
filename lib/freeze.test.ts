import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { loadMeals, noCooking, saveMeal, setDefaults } from './meals-db';
import { daysOfMonth, weightedMeals, type Meal } from './meals';
import { addEntry, loadMonth, openMonth, removeEntry } from './money-db';
import { closeMonth, freezeMonth, openStart } from './close';

// Plan 6c: a month's missing meal rows are filled just before it closes, so later usual-meals changes can't move its calendar
// away from its frozen bill. Spec: docs/superpowers/specs/2026-10-11-plan6c-freeze-meals-design.md (merge gates 1 to 7).
const SEP = '2026-09-01', CLOSE_DAY = '2026-10-01';
const cash = (t: number) => ({ cash: t, bkash: 0, nagad: 0, bank: 0 });
const OFF = { b: false, l: false, d: false };

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin', 'Zarif'], today: SEP, lang: 'bn' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id]));
  const nafis = { memberId: ids.Nafis, role: 'manager' as const };
  await openMonth(db, f.flatId, SEP);
  const version = async () => (await db<{ v: number }>(`select version as v from months where flat_id = $1 and month = $2::text::date`, [f.flatId, SEP]))[0].v;
  /** Weighted meals per person, recomputed from the calendar's own reads (loadMeals), as the Meals tab sees the month. */
  const calendar = async () => {
    const { flat, members, changes } = await loadMeals(db, f.flatId, SEP, daysOfMonth(SEP).at(-1)!);
    return weightedMeals(members, changes, SEP, flat.weights);
  };
  /** The month's frozen bill: weighted meals per person in month_balances. */
  const billed = async () => new Map((await db<{ id: string; m: number }>(
    `select member_id as id, weighted_meals as m from month_balances where flat_id = $1 and month = $2::text::date`, [f.flatId, SEP])).map(r => [r.id, r.m]));
  /** Calendar and bill agree for everyone the bill covers. */
  const agree = async () => {
    const [cal, bill] = [await calendar(), await billed()];
    expect(bill.size).toBe(3);
    for (const [id, m] of bill) expect(cal.get(id)).toBe(m);
  };
  const row = async (name: string, date: string, meal: Meal) => (await db<{ count: number; guests: number }>(
    `select count, guests from meal_changes where member_id = $1 and date = $2::text::date and meal = $3`, [ids[name], date, meal]))[0];
  const rows = async () => Number((await db<{ n: string }>(`select count(*)::text as n from meal_changes where flat_id = $1 and date between $2::text::date and '2026-09-30'`, [f.flatId, SEP]))[0].n);
  /** Deletes one saved row without firing its trigger (test-only setup), so nothing but the code under test moves the version. */
  const dropQuietly = async (name: string, date: string, meal: Meal) => {
    await db(`set session_replication_role = replica`);
    await db(`delete from meal_changes where member_id = $1 and date = $2::text::date and meal = $3`, [ids[name], date, meal]);
    await db(`set session_replication_role = origin`);
  };
  return { flatId: f.flatId, ids, nafis, version, calendar, billed, agree, row, rows, dropQuietly };
}

describe('freezing a month before it closes', { timeout: 30000 }, () => {
  it('gate 5: after a close, changing usual meals leaves the closed month’s calendar equal to its bill', async () => {
    const { flatId, ids, nafis, agree } = await flat();
    expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0))).result).toBe('ok');
    await agree();
    await setDefaults(db, flatId, ids.Tahsin, OFF, await openStart(db, flatId), CLOSE_DAY, false);
    await agree();
  });

  it('gates 1 and 2: fills only missing rows; no-cooking gives 0 to a missing row and leaves a saved one alone', async () => {
    const { flatId, ids, nafis, row, dropQuietly } = await flat();
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-05', meal: 'l', count: 0, guests: 0 }, false);   // differs from usual (on)
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-06', meal: 'd', count: 3, guests: 2 }, false);
    await noCooking(db, flatId, nafis.memberId, '2026-09-10', '2026-09-10', ['d'], '2026-08-31');
    await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-10', meal: 'd', count: 1, guests: 0 }, false);   // a saved 1 on a no-cooking meal
    await dropQuietly('Zarif', '2026-09-10', 'd');   // a no-cooking meal with no row
    expect(await freezeMonth(db, flatId, SEP)).toBeGreaterThan(0);
    expect(await row('Tahsin', '2026-09-05', 'l')).toEqual({ count: 0, guests: 0 });
    expect(await row('Tahsin', '2026-09-06', 'd')).toEqual({ count: 3, guests: 2 });
    expect(await row('Tahsin', '2026-09-10', 'd')).toEqual({ count: 1, guests: 0 });
    expect(await row('Zarif', '2026-09-10', 'd')).toEqual({ count: 0, guests: 0 });   // usual meal on, no-cooking wins
    expect(await row('Zarif', '2026-09-11', 'd')).toEqual({ count: 1, guests: 0 });   // an ordinary missing row: the usual meal
  });

  it('gate 4: every inserted row bumps the version once, a repeat inserts and bumps nothing, a stale close is refused', async () => {
    const { flatId, nafis, version, rows, dropQuietly, agree } = await flat();
    const v0 = await version(), before = await rows();
    const n = await freezeMonth(db, flatId, SEP);
    expect(n).toBe(3 * 30 * 3 - before);   // three people, 30 days, three meals
    expect(await version()).toBe(v0 + n);
    expect(await freezeMonth(db, flatId, SEP)).toBe(0);
    expect(await version()).toBe(v0 + n);
    // a close that loaded before a snapshot that inserted a row: only the snapshot moves the version, and the close writes nothing
    const r = await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0), async () => {
      await dropQuietly('Tahsin', '2026-09-20', 'b');
      expect(await freezeMonth(db, flatId, SEP)).toBe(1);
    });
    expect(r.result).toBe('changed');
    expect(await db(`select 1 from month_balances where flat_id = $1`, [flatId])).toEqual([]);
    expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0))).result).toBe('ok');
    await agree();
  });

  for (const cause of ['cash', 'pending'] as const) {
    it(`gate 3: a close refused for ${cause} leaves rows that change no number, and a later close gives the same numbers`, async () => {
      const { flatId, ids, nafis, calendar, billed, rows, agree } = await flat();
      await setDefaults(db, flatId, ids.Zarif, { b: false, l: true, d: true }, null, '2026-08-31');   // differing usual meals, nothing saved in September
      const before = { cal: await calendar(), month: (await loadMonth(db, flatId, SEP, CLOSE_DAY)).result.perMember };
      if (cause === 'pending') await addEntry(db, flatId, { memberId: ids.Tahsin, role: 'member' }, { type: 'deposit', amount: 5000, memberId: ids.Tahsin, date: '2026-09-05', note: null, paidBy: null, split: null, selected: [] });
      expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(cause === 'cash' ? 100 : 0))).result).toBe(cause);
      expect(await rows()).toBe(3 * 30 * 3);   // the snapshot rows stayed
      expect(await calendar()).toEqual(before.cal);
      expect((await loadMonth(db, flatId, SEP, CLOSE_DAY)).result.perMember).toEqual(before.month);
      if (cause === 'pending') {
        const [p] = await db<{ id: string }>(`select id from ledger where flat_id = $1 and status = 'pending'`, [flatId]);
        expect(await removeEntry(db, flatId, nafis, p.id, CLOSE_DAY)).toBeTruthy();
      }
      expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0))).result).toBe('ok');
      expect(await billed()).toEqual(before.cal);
      await agree();
    });
  }

  for (const order of ['usual meals first', 'snapshot first'] as const) {
    it(`gate 6: ${order}, existing rows stay and the closed month matches its bill`, async () => {
      const { flatId, ids, nafis, row, agree } = await flat();
      await saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-05', meal: 'l', count: 0, guests: 0 }, false);
      const change = async () => setDefaults(db, flatId, ids.Tahsin, OFF, await openStart(db, flatId), '2026-10-01', false);
      if (order === 'usual meals first') { await change(); await freezeMonth(db, flatId, SEP); }
      else { await freezeMonth(db, flatId, SEP); await change(); }
      expect(await row('Tahsin', '2026-09-05', 'l')).toEqual({ count: 0, guests: 0 });
      expect(await row('Tahsin', '2026-09-06', 'l')).toEqual({ count: 1, guests: 0 });   // September keeps the old usual meal
      expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0))).result).toBe('ok');
      await agree();
    });
  }

  it('gate 7: the closed-month guard still refuses writes, and freezing a closed month writes nothing', async () => {
    const { flatId, ids, nafis, version } = await flat();
    expect((await closeMonth(db, flatId, nafis, SEP, CLOSE_DAY, cash(0))).result).toBe('ok');
    const v = await version();
    expect(await freezeMonth(db, flatId, SEP)).toBe(0);
    expect(await version()).toBe(v);
    await expect(saveMeal(db, flatId, nafis.memberId, { memberId: ids.Tahsin, date: '2026-09-07', meal: 'l', count: 0, guests: 0 }, false)).rejects.toThrow('month_closed');
  });
});
