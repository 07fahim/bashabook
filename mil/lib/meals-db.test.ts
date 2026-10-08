import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { headcount, indexChanges, mealCount, type Meal } from './meals';
import {
  cancelAway, changeMeal, cookAgain, decideRequest, loadHistory, loadMeals, noCooking, requestMeal, saveMeal, setAway, setDefaults, setInMeals,
  upcomingAway, updateSettings,
} from './meals-db';

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

  it('turns a change into a save, a late save, a request or nothing', async () => {
    const { flatId, tahsin, load } = await flat();
    const c = (date: string) => ({ memberId: tahsin, date, meal: 'd' as const, count: 0 });
    expect(await changeMeal(db, flatId, c('2026-10-11'), '2026-10-09T23:00')).toBe('open');
    expect(await changeMeal(db, flatId, c('2026-10-10'), '2026-10-09T23:00')).toBe('late');
    expect(await changeMeal(db, flatId, c('2026-10-08'), '2026-10-09T23:00')).toBe('closed');
    await updateSettings(db, flatId, tahsin, { cutoff: '22:00', strictness: 'strict', weights: { b: 50, l: 100, d: 100 } });
    expect(await changeMeal(db, flatId, c('2026-10-09'), '2026-10-09T23:00')).toBe('closed');   // today
    expect(await changeMeal(db, flatId, { ...c('2026-10-10'), count: 2 }, '2026-10-09T23:00')).toBe('request');
    const { changes, requests } = await load();
    expect(changes.map(x => [x.date, x.late]).sort()).toEqual([['2026-10-10', true], ['2026-10-11', false]]);
    expect(requests.map(r => r.date)).toEqual(['2026-10-10']);
    expect(await changeMeal(db, flatId, c('2026-10-10'), '2026-10-09T23:00', true)).toBe('late');   // the approver doesn't wait on themselves
    expect((await load()).requests).toEqual([]);   // a direct save drops the waiting request
  });

  it('keeps one pending request per meal and applies it as late once approved', async () => {
    const { flatId, memberId, tahsin, load, count } = await flat();
    await requestMeal(db, flatId, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 2 });
    await requestMeal(db, flatId, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0 });
    const { requests } = await load();
    expect(requests.map(r => [r.name, r.date, r.meal, r.count])).toEqual([['Tahsin', '2026-10-10', 'l', 0]]);
    expect(await count('2026-10-10', 'l')).toBe(1);   // not applied yet
    expect(await decideRequest(db, flatId, memberId, requests[0].id, true, '2026-10-11')).toBe(false);   // day already gone
    expect(await decideRequest(db, flatId, memberId, requests[0].id, true, '2026-10-09')).toBe(true);
    expect(await decideRequest(db, flatId, memberId, requests[0].id, true, '2026-10-09')).toBe(false);   // only once
    const after = await load();
    expect(after.requests).toEqual([]);
    expect(after.changes).toEqual([{ memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0, late: true }]);
  });

  it("another flat can't decide this flat's requests", async () => {
    const a = await flat();
    const b = await flat();
    await requestMeal(db, a.flatId, { memberId: a.tahsin, date: '2026-10-10', meal: 'b', count: 0 });
    const [r] = (await a.load()).requests;
    expect(await decideRequest(db, b.flatId, b.memberId, r.id, true, '2026-10-09')).toBe(false);
    expect((await a.load()).requests).toHaveLength(1);
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

  it('no cooking switches the chosen meals off for everyone and drops waiting requests', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await requestMeal(db, flatId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 2 });
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'l', count: 3 }, false);
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-13', ['l', 'd'], '2026-10-09');
    const { members, changes, requests } = await load();
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-13')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-14')).toEqual({ b: 2, l: 2, d: 2 });
    expect(requests).toEqual([]);
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
    await setInMeals(db, flatId, tahsin, false, '2026-09-01', '2026-10-09');
    expect(await count('2026-10-09', 'l')).toBe(1);   // locked day keeps the old usual meal
    expect(await count('2026-10-10', 'l')).toBe(0);
    expect((await load()).members.find(m => m.id === tahsin)!.inMeals).toBe(false);
    await setInMeals(db, flatId, tahsin, true, '2026-09-01', '2026-10-09');
    expect(await count('2026-10-10', 'l')).toBe(1);
  });

  it('saves meal weights with the other rules', async () => {
    const { flatId, memberId, load } = await flat();
    await updateSettings(db, flatId, memberId, { cutoff: '21:30', strictness: 'relaxed', weights: { b: 75, l: 100, d: 125 } });
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

  it('a request that matches what is saved only drops the waiting one; rejections are in history', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await updateSettings(db, flatId, memberId, { cutoff: '22:00', strictness: 'strict', weights: { b: 50, l: 100, d: 100 } });
    const c = (count: number) => ({ memberId: tahsin, date: '2026-10-10', meal: 'l' as const, count });
    expect(await changeMeal(db, flatId, c(0), '2026-10-09T23:00')).toBe('request');
    expect(await changeMeal(db, flatId, c(1), '2026-10-09T23:00')).toBe('open');   // back to usual: nothing to approve
    expect((await load()).requests).toEqual([]);
    await changeMeal(db, flatId, c(0), '2026-10-09T23:00');
    const [r] = (await load()).requests;
    await decideRequest(db, flatId, memberId, r.id, false, '2026-10-09');
    const [h] = await loadHistory(db, flatId);
    expect([h.actor, h.who, h.after.rejected]).toEqual(['Nafis', 'Tahsin', true]);
  });

  it('cooking for yourself clears plain booked meals but keeps guests', async () => {
    const { flatId, tahsin, count } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 1 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-13', meal: 'd', count: 3 }, false);
    await setInMeals(db, flatId, tahsin, false, '2026-09-01', '2026-10-09');
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
    await updateSettings(db, flatId, memberId, { cutoff: '21:00', strictness: 'relaxed', weights: { b: 50, l: 100, d: 100 } });
    await saveMeal(db, flatId, memberId, { memberId, date: '2026-10-09', meal: 'l', count: 0 }, true);   // Nafis, own, late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 0 }, true);
    expect((await loadHistory(db, flatId))[2].entity).toBe('flats');
    const mine = await loadHistory(db, flatId, tahsin);
    expect(mine.map(h => h.entity)).toEqual(['meal_changes', 'flats']);   // my meal + the flat-wide rule change
  });
});
