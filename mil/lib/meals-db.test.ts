import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { headcount, indexChanges, mealCount, type Meal } from './meals';
import { changeMeal, decideRequest, loadHistory, loadMeals, noCooking, requestMeal, saveMeal, setAway, setDefaults, updateSettings } from './meals-db';

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
    await updateSettings(db, flatId, { cutoff: '22:00', strictness: 'strict' });
    expect(await changeMeal(db, flatId, c('2026-10-09'), '2026-10-09T23:00')).toBe('closed');   // today
    expect(await changeMeal(db, flatId, c('2026-10-10'), '2026-10-09T23:00')).toBe('request');
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
    await setDefaults(db, flatId, tahsin, { b: false, l: true, d: true }, '2026-10-09');
    expect(await count('2026-10-01', 'b')).toBe(1);   // joined 1 October, old usual kept
    expect(await count('2026-10-05', 'b')).toBe(2);   // saved change untouched
    expect(await count('2026-10-09', 'b')).toBe(1);
    expect(await count('2026-10-10', 'b')).toBe(0);   // new usual from here
    expect((await load()).members.find(m => m.id === tahsin)!.defaults).toEqual({ b: false, l: true, d: true });
  });

  it('no cooking switches the chosen meals off for everyone and drops waiting requests', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await requestMeal(db, flatId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 2 });
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-13', ['l', 'd']);
    const { members, changes, requests } = await load();
    expect(headcount(members, changes, '2026-10-12')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-13')).toEqual({ b: 2, l: 0, d: 0 });
    expect(headcount(members, changes, '2026-10-14')).toEqual({ b: 2, l: 2, d: 2 });
    expect(requests).toEqual([]);
  });

  it('history shows late, for-someone-else, away and no-cooking changes, not ordinary ones', async () => {
    const { flatId, memberId, tahsin } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'b', count: 0 }, false);   // ordinary: hidden
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0 }, true);    // late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 3 }, true);  // Nafis for Tahsin
    await setAway(db, flatId, tahsin, '2026-10-20', '2026-10-21');
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['b']);
    const h = await loadHistory(db, flatId);
    expect(h.map(r => [r.actor, r.who, r.entityId.split('|').slice(1).join('|')])).toEqual([
      ['Nafis', null, 'nocook'], ['Tahsin', 'Tahsin', 'away'], ['Nafis', 'Tahsin', '2026-10-09|d'], ['Tahsin', 'Tahsin', '2026-10-10|l'],
    ]);
  });
});
