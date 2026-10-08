import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { headcount, indexChanges, mealCount, type Meal } from './meals';
import {
  cancelAway, changeMeal, cookAgain, loadHistory, loadMeals, noCooking, saveMeal, setAway, setDefaults, upcomingAway, updateSettings,
} from './meals-db';

const ALL_OFF = { b: false, l: false, d: false }, ALL_ON = { b: true, l: true, d: true };

async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Tahsin'], today: '2026-10-01', lang: 'bn' });
  const load = () => loadMeals(db, f.flatId, '2026-09-01', '2026-10-31');
  const tahsin = (await load()).members.find(m => m.name === 'Tahsin')!.id;
  const count = async (date: string, meal: Meal) => {
    const { members, changes } = await load();
    return mealCount(members.find(m => m.id === tahsin)!, indexChanges(changes), date, meal);
  };
  return { ...f, tahsin, load, count };
}

describe('meal storage', { timeout: 30000 }, () => {
  it('saves a change with an audit row and moves the headcount', async () => {
    const { flatId, tahsin, load } = await flat();
    expect(headcount((await load()).members, [], '2026-10-10')).toEqual({ b: 2, l: 2, d: 2 });
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'd', count: 3 }, true);
    const { members, changes } = await load();
    expect(headcount(members, changes, '2026-10-10')).toEqual({ b: 2, l: 1, d: 4 });
    expect(changes.find(c => c.meal === 'd')!.late).toBe(true);
    const log = await db<{ before: unknown; after: { count: number } }>(
      `select before, after from audit_log where flat_id = $1 and entity = 'meal_changes' order by id`, [flatId]);
    expect(log.map(l => [l.before, l.after.count])).toEqual([[null, 0], [null, 3]]);
  });

  it('turns a change into a save, a late save or nothing', async () => {
    const { flatId, tahsin, load } = await flat();
    const c = (date: string) => ({ memberId: tahsin, date, meal: 'd' as const, count: 0 });
    expect(await changeMeal(db, flatId, c('2026-10-11'), '2026-10-09T23:00')).toBe('open');
    expect(await changeMeal(db, flatId, c('2026-10-10'), '2026-10-09T23:00')).toBe('late');
    expect(await changeMeal(db, flatId, c('2026-10-08'), '2026-10-09T23:00')).toBe('closed');
    expect(await changeMeal(db, flatId, c('2026-10-09'), '2026-10-09T23:00')).toBe('closed');   // today
    const { changes } = await load();
    expect(changes.map(x => [x.date, x.late]).sort()).toEqual([['2026-10-10', true], ['2026-10-11', false]]);
  });

  it('away turns every meal off for the range', async () => {
    const { flatId, tahsin, load } = await flat();
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-13');
    const { members, changes } = await load();
    expect(headcount(members, changes, '2026-10-11')).toEqual({ b: 2, l: 2, d: 2 });
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 1, l: 1, d: 1 });
    expect(headcount(members, changes, '2026-10-13')).toEqual({ b: 1, l: 1, d: 1 });
    expect(headcount(members, changes, '2026-10-14')).toEqual({ b: 2, l: 2, d: 2 });
  });

  it('new usual meals leave locked days as they were', async () => {
    const { flatId, tahsin, load, count } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-05', meal: 'b', count: 2 }, false);
    await setDefaults(db, flatId, tahsin, { b: false, l: true, d: true }, '2026-09-01', '2026-10-09');
    expect(await count('2026-10-01', 'b')).toBe(1);   // joined 1 October, old usual kept
    expect(await count('2026-10-05', 'b')).toBe(2);   // saved change untouched
    expect(await count('2026-10-09', 'b')).toBe(1);
    expect(await count('2026-10-10', 'b')).toBe(0);   // new usual from here
    expect((await load()).members.find(m => m.id === tahsin)!.defaults).toEqual({ b: false, l: true, d: true });
  });

  it('no cooking switches the chosen meals off for everyone', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'l', count: 3 }, false);
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-13', ['l', 'd'], '2026-10-09');
    const { members, changes } = await load();
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-13')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-14')).toEqual({ b: 2, l: 2, d: 2 });
    const [log] = await db<{ before: { c: number }[] }>(`select before from audit_log where entity_id = 'flat|nocook' and flat_id = $1`, [flatId]);
    expect(log.before.map(x => x.c)).toEqual([3]);   // old guest plates kept for the record
  });

  it('history shows late, for-someone-else, away and no-cooking changes, not ordinary ones', async () => {
    const { flatId, memberId, tahsin } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'b', count: 0 }, false);   // ordinary: hidden
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0 }, true);    // late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 3 }, true);  // Nafis for Tahsin
    await setAway(db, flatId, tahsin, '2026-10-20', '2026-10-21');
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['b'], '2026-10-09');
    const h = await loadHistory(db, flatId);
    expect(h.map(r => [r.actor, r.who, r.entityId.split('|').slice(1).join('|')])).toEqual([
      ['Nafis', null, 'nocook'], ['Tahsin', 'Tahsin', 'away'], ['Nafis', 'Tahsin', '2026-10-09|d'], ['Tahsin', 'Tahsin', '2026-10-10|l'],
    ]);
  });

  it('cooking for yourself keeps locked days and counts no meals after', async () => {
    const { flatId, tahsin, load, count } = await flat();
    await setDefaults(db, flatId, tahsin, ALL_OFF, '2026-09-01', '2026-10-09', false);
    expect(await count('2026-10-09', 'l')).toBe(1);   // locked day keeps the old usual meal
    expect(await count('2026-10-10', 'l')).toBe(0);
    expect((await load()).members.find(m => m.id === tahsin)!.inMeals).toBe(false);
    await setDefaults(db, flatId, tahsin, ALL_ON, '2026-09-01', '2026-10-09', true);
    expect(await count('2026-10-10', 'l')).toBe(1);
  });

  it('saves meal weights with the other rules', async () => {
    const { flatId, memberId, load } = await flat();
    await updateSettings(db, flatId, memberId, { cutoff: '21:30', weights: { b: 75, l: 100, d: 125 } });
    const { flat: f } = await load();
    expect([f.cutoff, f.weights]).toEqual(['21:30:00', { b: 75, l: 100, d: 125 }]);
  });

  it('no-cooking days are closed to members, and cooking again brings usual meals back', async () => {
    const { flatId, memberId, tahsin, load, count } = await flat();
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-13', ['d'], '2026-10-09');
    expect(await changeMeal(db, flatId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 1 }, '2026-10-09T10:00')).toBe('closed');
    expect((await load()).noCook).toHaveLength(2);
    await cookAgain(db, flatId, memberId, '2026-10-12', '2026-10-13', ['d'], '2026-10-10');
    expect((await load()).noCook).toEqual([]);
    expect(await count('2026-10-12', 'd')).toBe(1);   // usual meal back
  });

  it('cooking for yourself clears plain booked meals but keeps guests', async () => {
    const { flatId, tahsin, count } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 1 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-13', meal: 'd', count: 3 }, false);
    await setDefaults(db, flatId, tahsin, ALL_OFF, '2026-09-01', '2026-10-09', false);
    expect(await count('2026-10-12', 'd')).toBe(0);
    expect(await count('2026-10-13', 'd')).toBe(3);
  });

  it('away can be listed and cancelled', async () => {
    const { flatId, tahsin, count } = await flat();
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-20');
    expect(await upcomingAway(db, flatId, tahsin, '2026-10-10')).toEqual([['2026-10-12', '2026-10-20']]);
    await cancelAway(db, flatId, tahsin, '2026-10-12', '2026-10-20');
    expect(await upcomingAway(db, flatId, tahsin, '2026-10-10')).toEqual([]);
    expect(await count('2026-10-15', 'l')).toBe(1);
  });

  it('history shows rule changes and can be limited to my meals', async () => {
    const { flatId, memberId, tahsin } = await flat();
    await updateSettings(db, flatId, memberId, { cutoff: '21:00', weights: { b: 50, l: 100, d: 100 } });
    await saveMeal(db, flatId, memberId, { memberId, date: '2026-10-09', meal: 'l', count: 0 }, true);   // Nafis, own, late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 0 }, true);
    expect((await loadHistory(db, flatId))[2].entity).toBe('flats');
    const mine = await loadHistory(db, flatId, tahsin);
    expect(mine.map(h => h.entity)).toEqual(['meal_changes', 'flats']);   // my meal + the flat-wide rule change
  });

  it('a no-cooking meal stays 0 even after away is cancelled or someone moves in', async () => {
    const { flatId, memberId, tahsin, load, count } = await flat();
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-20');
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['d'], '2026-10-09');
    await cancelAway(db, flatId, tahsin, '2026-10-12', '2026-10-20');
    expect(await count('2026-10-15', 'd')).toBe(0);
    expect(await count('2026-10-15', 'l')).toBe(1);
    await db(`insert into members (flat_id, name, joined_on) values ($1, 'Rafi', '2026-10-14')`, [flatId]);
    const { members, changes } = await load();
    expect(headcount(members, changes, '2026-10-15').d).toBe(0);
  });

  it('cooking again only touches blocked meals and restores what was there', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    await setAway(db, flatId, tahsin, '2026-10-20', '2026-10-21');
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-15', meal: 'd', count: 3 }, false);
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['d'], '2026-10-09');
    await cookAgain(db, flatId, memberId, '2026-10-15', '2026-10-21', ['d'], '2026-10-10');   // range wider than the block
    expect(await count('2026-10-15', 'd')).toBe(3);   // guest plates back
    expect(await count('2026-10-20', 'd')).toBe(0);   // away untouched
  });

  it('overlapping away ranges are listed as one; cooking for yourself and back keeps away', async () => {
    const { flatId, tahsin, count } = await flat();
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-20');
    await setAway(db, flatId, tahsin, '2026-10-18', '2026-10-25');
    expect(await upcomingAway(db, flatId, tahsin, '2026-10-10')).toEqual([['2026-10-12', '2026-10-25']]);
    await cancelAway(db, flatId, tahsin, '2026-10-12', '2026-10-14');
    expect(await upcomingAway(db, flatId, tahsin, '2026-10-10')).toEqual([['2026-10-15', '2026-10-25']]);
    await setDefaults(db, flatId, tahsin, ALL_OFF, '2026-09-01', '2026-10-09', false);
    await setDefaults(db, flatId, tahsin, ALL_ON, '2026-09-01', '2026-10-09', true);
    expect(await count('2026-10-16', 'l')).toBe(0);
    expect(await count('2026-10-13', 'l')).toBe(1);
  });

  it('a plain usual-meals change stays a usual-meals change in history', async () => {
    const { flatId, tahsin } = await flat();
    await setDefaults(db, flatId, tahsin, { b: false, l: true, d: true }, '2026-09-01', '2026-10-09', null);
    const [h] = await loadHistory(db, flatId);
    expect([h.entity, h.after.inMeals]).toEqual(['members', undefined]);
  });

  it('cancelling no cooking for a locked day brings that day back', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    await noCooking(db, flatId, memberId, '2026-10-09', '2026-10-09', ['d'], '2026-10-09');
    await cookAgain(db, flatId, memberId, '2026-10-09', '2026-10-09', ['d'], '2026-10-09');
    expect(await count('2026-10-09', 'd')).toBe(1);
    expect(tahsin).toBeTruthy();
  });
});
