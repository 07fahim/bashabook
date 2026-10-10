import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { addMember, bringBack, createFlat } from './auth';
import { countChanges, headcount, indexChanges, mealCount, type Meal } from './meals';
import {
  addGuests, cancelAway, countAtLock, currentPlates, removeGuests, setOwn, cookAgain, loadHistory, loadMeals, noCooking, saveMeal, seedLock, setAway, setDefaults, toldCook, upcomingAway, updateSettings,
} from './meals-db';

const ALL_OFF = { b: false, l: false, d: false }, ALL_ON = { b: true, l: true, d: true };
const LATE = '2026-10-31T23:00';   // a moment after every lock in these tests

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
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0, guests: 0 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'd', count: 3, guests: 2 }, true);
    const { members, changes } = await load();
    expect(headcount(members, changes, '2026-10-10')).toEqual({ b: 2, l: 1, d: 4 });
    expect(changes.find(c => c.meal === 'd')!.late).toBe(true);
    const log = await db<{ before: unknown; after: { count: number } }>(
      `select before, after from audit_log where flat_id = $1 and entity = 'meal_changes' order by id`, [flatId]);
    expect(log.map(l => [l.before, l.after.count])).toEqual([[null, 0], [null, 3]]);
  });

  it('turns a change into a save, a late save or nothing', async () => {
    const { flatId, tahsin, load } = await flat();
    const own = (date: string) => setOwn(db, flatId, tahsin, date, 'd', 0, '2026-10-09T23:00');
    expect(await own('2026-10-11')).toBe('open');
    expect(await own('2026-10-10')).toBe('late');
    expect(await own('2026-10-08')).toBe('closed');
    expect(await own('2026-10-09')).toBe('closed');   // today
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
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-05', meal: 'b', count: 2, guests: 1 }, false);
    await setDefaults(db, flatId, tahsin, { b: false, l: true, d: true }, '2026-09-01', '2026-10-09');
    expect(await count('2026-10-01', 'b')).toBe(1);   // joined 1 October, old usual kept
    expect(await count('2026-10-05', 'b')).toBe(2);   // saved change untouched
    expect(await count('2026-10-09', 'b')).toBe(1);
    expect(await count('2026-10-10', 'b')).toBe(0);   // new usual from here
    expect((await load()).members.find(m => m.id === tahsin)!.defaults).toEqual({ b: false, l: true, d: true });
  });

  it('no cooking switches the chosen meals off for everyone', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'l', count: 3, guests: 2 }, false);
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
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'b', count: 0, guests: 0 }, false);   // ordinary: hidden
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-10', meal: 'l', count: 0, guests: 0 }, true);    // late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 3, guests: 2 }, true);  // Nafis for Tahsin
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
    await updateSettings(db, flatId, memberId, { cutoff: '21:30', weights: { b: 75, l: 100, d: 125 } }, '2026-10-09T10:00');
    const { flat: f } = await load();
    expect([f.cutoff, f.weights]).toEqual(['21:30:00', { b: 75, l: 100, d: 125 }]);
  });

  it('no-cooking days are closed to members, and cooking again brings usual meals back', async () => {
    const { flatId, memberId, tahsin, load, count } = await flat();
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-13', ['d'], '2026-10-09');
    expect(await setOwn(db, flatId, tahsin, '2026-10-12', 'd', 1, '2026-10-09T10:00')).toBe('closed');
    expect((await load()).noCook).toHaveLength(2);
    await cookAgain(db, flatId, memberId, '2026-10-12', '2026-10-13', ['d'], '2026-10-10');
    expect((await load()).noCook).toEqual([]);
    expect(await count('2026-10-12', 'd')).toBe(1);   // usual meal back
  });

  it('cooking for yourself clears plain booked meals but keeps guests', async () => {
    const { flatId, tahsin, count } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 1, guests: 0 }, false);
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-13', meal: 'd', count: 3, guests: 2 }, false);
    await setDefaults(db, flatId, tahsin, ALL_OFF, '2026-09-01', '2026-10-09', false);
    expect(await count('2026-10-12', 'd')).toBe(0);
    expect(await count('2026-10-13', 'd')).toBe(2);   // the 2 guests stay, my own plate goes
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
    await updateSettings(db, flatId, memberId, { cutoff: '21:00', weights: { b: 50, l: 100, d: 100 } }, '2026-10-09T10:00');
    await saveMeal(db, flatId, memberId, { memberId, date: '2026-10-09', meal: 'l', count: 0, guests: 0 }, true);   // Nafis, own, late
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'd', count: 0, guests: 0 }, true);
    expect((await loadHistory(db, flatId))[2].entity).toBe('flats');
    // Show older changes reloads a longer slice of the same newest-first list: a shorter one is exactly its start
    const all = await loadHistory(db, flatId);
    expect(await loadHistory(db, flatId, null, 2)).toEqual(all.slice(0, 2));
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
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-15', meal: 'd', count: 3, guests: 2 }, false);
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['d'], '2026-10-09');
    await cookAgain(db, flatId, memberId, '2026-10-15', '2026-10-21', ['d'], '2026-10-10');   // range wider than the block
    expect(await count('2026-10-15', 'd')).toBe(3);   // guest plates back
    expect(await count('2026-10-20', 'd')).toBe(0);   // away untouched
  });

  it('away set on a no-cooking day stays off when cooking starts again', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-15', meal: 'd', count: 1, guests: 0 }, false);
    await noCooking(db, flatId, memberId, '2026-10-15', '2026-10-15', ['d'], '2026-10-09');
    await setAway(db, flatId, tahsin, '2026-10-14', '2026-10-16');
    await cookAgain(db, flatId, memberId, '2026-10-15', '2026-10-15', ['d'], '2026-10-10');
    expect(await count('2026-10-15', 'd')).toBe(0);
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

  it('saving the same meal twice writes one history line', async () => {
    const { flatId, tahsin } = await flat();
    const c = { memberId: tahsin, date: '2026-10-10', meal: 'l' as const, count: 0, guests: 0 };
    await saveMeal(db, flatId, tahsin, c, true);
    await saveMeal(db, flatId, tahsin, c, true);
    expect((await loadHistory(db, flatId)).filter(h => h.entityId.endsWith('2026-10-10|l'))).toHaveLength(1);
  });

  it('today: guests are added on top, never lowered, never the host own plate', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    const now = '2026-10-09T13:00', add = (date: string, meal: Meal, guests: number) => addGuests(db, flatId, tahsin, date, meal, guests, now);
    expect(await add('2026-10-09', 'd', 2)).toBe('late');            // usual dinner 1 + 2 guests
    expect(await count('2026-10-09', 'd')).toBe(3);
    expect(await add('2026-10-09', 'd', 1)).toBe('late');            // one more on top, not a total
    expect(await count('2026-10-09', 'd')).toBe(4);
    expect(await add('2026-10-09', 'd', 0)).toBe('closed');          // nothing to add: no rewrite, no silent overwrite
    expect(await count('2026-10-09', 'd')).toBe(4);
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-09', meal: 'l', count: 0, guests: 0 }, true);   // lunch off today
    expect(await add('2026-10-09', 'l', 0)).toBe('closed');          // cannot switch my own meal back on
    expect(await count('2026-10-09', 'l')).toBe(0);
    expect(await add('2026-10-08', 'd', 2)).toBe('closed');          // past day
    await noCooking(db, flatId, memberId, '2026-10-09', '2026-10-09', ['b'], '2026-10-09');
    expect(await add('2026-10-09', 'b', 2)).toBe('closed');          // no cooking today
    await db(`update members set joined_on = '2026-10-20' where id = $1`, [tahsin]);
    expect(await add('2026-10-09', 'd', 2)).toBe('closed');          // not moved in yet
    await db(`update members set joined_on = '2026-10-01' where id = $1`, [tahsin]);
    const h = (await loadHistory(db, flatId)).filter(x => x.entityId.endsWith('2026-10-09|d'));
    expect(h.map(x => [x.after.count, x.after.late])).toEqual([[4, true], [3, true]]);   // both additions in history
  });

  it('a later day also adds on top and never switches my own meal on', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    const add = (meal: Meal, guests: number) => addGuests(db, flatId, tahsin, '2026-10-12', meal, guests, '2026-10-09T13:00');
    expect(await add('l', 2)).toBe('open');
    expect(await count('2026-10-12', 'l')).toBe(3);                   // my lunch + 2 guests
    expect(await add('l', 1)).toBe('open');
    expect(await count('2026-10-12', 'l')).toBe(4);                   // one more on top, not a new total
    await saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 0, guests: 0 }, false);   // my dinner off
    expect(await add('d', 1)).toBe('open');
    expect(await count('2026-10-12', 'd')).toBe(1);                   // only the guest, my dinner stays off
  });

  it('guest plates and my own plate are separate facts (the four approved scenarios)', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    const now = '2026-10-09T13:00', day = '2026-10-12';
    const plates = (meal: Meal) => currentPlates(db, flatId, tahsin, day, meal);
    // 1. lunch on, add one guest: guests +1, own stays on
    await addGuests(db, flatId, tahsin, day, 'l', 1, now);
    expect(await plates('l')).toEqual({ own: 1, guests: 1 });
    // 2. dinner off, add one guest: the guest is recorded, my dinner stays off
    await setOwn(db, flatId, tahsin, day, 'd', 0, now);
    await addGuests(db, flatId, tahsin, day, 'd', 1, now);
    expect(await plates('d')).toEqual({ own: 0, guests: 1 });
    // 3. a second guest adds on top
    await addGuests(db, flatId, tahsin, day, 'l', 1, now);
    expect(await plates('l')).toEqual({ own: 1, guests: 2 });
    expect(await count(day, 'l')).toBe(3);                            // billing still reads one total
    // 4. remove guests: only the guests go, my own lunch stays, and history records it
    expect(await removeGuests(db, flatId, tahsin, day, 'l', now)).toBe('open');
    expect(await plates('l')).toEqual({ own: 1, guests: 0 });
    const [h] = await loadHistory(db, flatId, tahsin);
    expect([h.entityId.endsWith(`${day}|l`), h.after.count, h.after.guests]).toEqual([true, 1, 0]);
    // switching my own plate keeps my guests
    await setOwn(db, flatId, tahsin, day, 'd', 1, now);
    expect(await plates('d')).toEqual({ own: 1, guests: 1 });
    // today: guests can be added but not removed by a member
    await addGuests(db, flatId, tahsin, '2026-10-09', 'd', 1, now);
    expect(await removeGuests(db, flatId, tahsin, '2026-10-09', 'd', now)).toBe('closed');
    expect((await currentPlates(db, flatId, tahsin, '2026-10-09', 'd'))!.guests).toBe(1);
    expect(memberId).toBeTruthy();
  });

  it('an own plate above 1 or a negative guest count is rejected, never adjusted', async () => {
    const { flatId, memberId, tahsin } = await flat();
    await expect(saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 3, guests: 1 }, false)).rejects.toThrow();
    await expect(saveMeal(db, flatId, memberId, { memberId: tahsin, date: '2026-10-12', meal: 'd', count: 1, guests: 2 }, false)).rejects.toThrow();
  });

  it('away and no cooking zero both the own plate and the guests; cooking again restores both', async () => {
    const { flatId, memberId, tahsin } = await flat();
    const now = '2026-10-09T13:00';
    await addGuests(db, flatId, tahsin, '2026-10-12', 'l', 2, now);
    // away says which booked guests it dropped, so the host is never surprised
    expect(await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-12')).toEqual([{ date: '2026-10-12', meal: 'l', guests: 2 }]);
    expect(await currentPlates(db, flatId, tahsin, '2026-10-12', 'l')).toEqual({ own: 0, guests: 0 });
    await addGuests(db, flatId, tahsin, '2026-10-13', 'd', 2, now);
    await noCooking(db, flatId, memberId, '2026-10-13', '2026-10-13', ['d'], '2026-10-09');
    expect(await currentPlates(db, flatId, tahsin, '2026-10-13', 'd')).toEqual({ own: 0, guests: 0 });
    await cookAgain(db, flatId, memberId, '2026-10-13', '2026-10-13', ['d'], '2026-10-10');
    expect(await currentPlates(db, flatId, tahsin, '2026-10-13', 'd')).toEqual({ own: 1, guests: 2 });
  });

  it('away lists the guests it dropped in day and meal order, once', async () => {
    const { flatId, tahsin } = await flat();
    const now = '2026-10-09T13:00';
    await addGuests(db, flatId, tahsin, '2026-10-11', 'l', 1, now);   // outside the range
    await addGuests(db, flatId, tahsin, '2026-10-12', 'd', 3, now);
    await addGuests(db, flatId, tahsin, '2026-10-12', 'l', 1, now);
    expect(await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-13')).toEqual([
      { date: '2026-10-12', meal: 'l', guests: 1 }, { date: '2026-10-12', meal: 'd', guests: 3 }]);
    expect(await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-13')).toEqual([]);
  });

  it('a meal takes at most 9 guests, so it never passes 10 plates', async () => {
    const { flatId, tahsin } = await flat();
    expect(await addGuests(db, flatId, tahsin, '2026-10-12', 'd', 9, '2026-10-09T13:00')).toBe('open');
    expect(await addGuests(db, flatId, tahsin, '2026-10-12', 'd', 1, '2026-10-09T13:00')).toBe('full');
    expect(await currentPlates(db, flatId, tahsin, '2026-10-12', 'd')).toEqual({ own: 1, guests: 9 });
  });

  it('cooking again reads a no-cooking snapshot saved before guests had their own column', async () => {
    const { flatId, memberId, tahsin } = await flat();
    await saveMeal(db, flatId, tahsin, { memberId: tahsin, date: '2026-10-13', meal: 'd', count: 3, guests: 2 }, false);
    await noCooking(db, flatId, memberId, '2026-10-13', '2026-10-13', ['d'], '2026-10-09');
    // make the snapshot look like one written before migration 004 (no g)
    await db(`update audit_log set before = (select jsonb_agg(e - 'g') from jsonb_array_elements(before) e) where entity_id = 'flat|nocook'`);
    await cookAgain(db, flatId, memberId, '2026-10-13', '2026-10-13', ['d'], '2026-10-10');
    expect(await currentPlates(db, flatId, tahsin, '2026-10-13', 'd')).toEqual({ own: 1, guests: 2 });
  });

  it('switching to cooking for myself drops my own plate but keeps booked guests', async () => {
    const { flatId, tahsin } = await flat();
    await addGuests(db, flatId, tahsin, '2026-10-14', 'l', 2, '2026-10-09T13:00');
    await setDefaults(db, flatId, tahsin, ALL_OFF, '2026-09-01', '2026-10-10', false);
    expect(await currentPlates(db, flatId, tahsin, '2026-10-14', 'l')).toEqual({ own: 0, guests: 2 });
  });

  it('keeps the count first seen after the lock, so any later change shows, even a new member', async () => {
    const { flatId, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    const first = await hc();
    expect(await countAtLock(db, flatId, '2026-10-10', first, LATE)).toEqual(first);   // first view saves it
    await addMember(db, flatId, 'Rafi', '2026-10-10');                             // no meal row is written for this
    const now = await hc();
    expect(now.l).toBe(first.l + 1);
    expect(await countAtLock(db, flatId, '2026-10-10', now, LATE)).toEqual(first);      // still the first one
    expect(await countAtLock(db, flatId, '2026-10-11', now, LATE)).toEqual(now);        // a new day starts over
  });

  it('after the lock, deleted rows count as a change, and a count back at the baseline shows none', async () => {
    const { flatId, tahsin, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-12'); };
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-12');
    await countAtLock(db, flatId, '2026-10-12', await hc(), LATE);        // first view after the lock
    await cancelAway(db, flatId, tahsin, '2026-10-12', '2026-10-12');            // deletes Tahsin's rows
    expect(countChanges(await countAtLock(db, flatId, '2026-10-12', await hc(), LATE), await hc())).toEqual([{ meal: 'b', from: 1, to: 2 }, { meal: 'l', from: 1, to: 2 }, { meal: 'd', from: 1, to: 2 }]);
    await setAway(db, flatId, tahsin, '2026-10-12', '2026-10-12');               // back to what it was
    expect(countChanges(await countAtLock(db, flatId, '2026-10-12', await hc(), LATE), await hc())).toEqual([]);
  });

  it('a change after the lock is flagged even if nobody opened the card first', async () => {
    const { flatId, tahsin, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    const before = await hc();
    await seedLock(db, flatId, '2026-10-09T22:05');                                  // what every action runs first
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:05');
    expect(countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc())).toEqual([{ meal: 'l', from: before.l, to: before.l + 1 }]);
  });

  it('before the lock, seeding saves no baseline', async () => {
    const { flatId } = await flat();
    await seedLock(db, flatId, '2026-10-09T21:00');
    const [f] = await db<{ d: string | null }>(`select lock_date::text as d from flats where id = $1`, [flatId]);
    expect(f.d).toBeNull();
  });

  it('telling the cook clears the warning for everyone; a later change shows from the told count', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    const warn = async () => countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc());
    await seedLock(db, flatId, '2026-10-09T22:05');
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:05');   // 2 → 3
    expect(await warn()).toEqual([{ meal: 'l', from: 2, to: 3 }]);
    await toldCook(db, flatId, memberId, '2026-10-10', await hc());
    expect(await warn()).toEqual([]);
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:10');   // 3 → 4
    expect(await warn()).toEqual([{ meal: 'l', from: 3, to: 4 }]);
    // everyone can see who said they told the cook, and which count
    const h = (await loadHistory(db, flatId)).find(x => x.entity === 'cook')!;
    expect([h.entity, h.actor, h.after.told, h.after.plates]).toEqual(['cook', 'Nafis', '2026-10-10', { b: 2, l: 3, d: 2 }]);
  });

  it('a tap from an out-of-date screen changes nothing: no hidden change, no false alarm', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    await seedLock(db, flatId, '2026-10-09T22:05');
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:05');
    const seen = await hc();                                                          // Lunch 3 on Nafis's screen
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:06');   // Lunch 4 before the tap
    expect(await toldCook(db, flatId, memberId, '2026-10-10', seen)).toBe(false);    // the screen showed 3, the count is 4
    expect(countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc())).toEqual([{ meal: 'l', from: 2, to: 4 }]);
    expect(await toldCook(db, flatId, memberId, '2026-10-10', await hc())).toBe(true);   // Tahsin tells the cook 4
    expect(await toldCook(db, flatId, memberId, '2026-10-10', seen)).toBe(false);        // Nafis's old screen still shows 3
    expect(countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc())).toEqual([]);   // no false alarm
    const lines = (await loadHistory(db, flatId)).length;
    await toldCook(db, flatId, memberId, '2026-10-09', await hc());                            // a date the baseline is not for
    expect((await loadHistory(db, flatId)).length).toBe(lines);                                 // changes nothing, so no history line
    expect(countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc())).toEqual([]);
  });

  it('telling the same count twice writes one history line', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    await seedLock(db, flatId, '2026-10-09T22:05');
    await addGuests(db, flatId, tahsin, '2026-10-10', 'l', 1, '2026-10-09T22:05');
    expect(await toldCook(db, flatId, memberId, '2026-10-10', await hc())).toBe(true);
    expect(await toldCook(db, flatId, memberId, '2026-10-10', await hc())).toBe(false);   // a double tap
    expect((await loadHistory(db, flatId)).filter(x => x.entity === 'cook')).toHaveLength(1);
  });

  it('the lock check and the save are one step: before the lock time nothing is saved', async () => {
    const { flatId, load } = await flat();
    const { members, changes } = await load();
    const hc = headcount(members, changes, '2026-10-10');
    expect(await countAtLock(db, flatId, '2026-10-10', hc, '2026-10-09T21:59')).toEqual(hc);   // no baseline, so no change
    const [f] = await db<{ d: string | null }>(`select lock_date::text as d from flats where id = $1`, [flatId]);
    expect(f.d).toBeNull();
  });

  it('a lock time that reopens tomorrow clears the baseline; one that keeps it locked does not', async () => {
    const { flatId, memberId } = await flat();
    const lock = async () => (await db<{ d: string | null }>(`select lock_date::text as d from flats where id = $1`, [flatId]))[0].d;
    const weights = { b: 50, l: 100, d: 100 };
    await seedLock(db, flatId, '2026-10-09T22:05');
    await updateSettings(db, flatId, memberId, { cutoff: '22:00', weights: { ...weights, b: 100 } }, '2026-10-09T22:10');
    expect(await lock()).toBe('2026-10-10');                                          // weights only
    await updateSettings(db, flatId, memberId, { cutoff: '21:30', weights }, '2026-10-09T22:10');
    expect(await lock()).toBe('2026-10-10');                                          // still locked: the cook may already know
    await updateSettings(db, flatId, memberId, { cutoff: '23:00', weights }, '2026-10-09T22:10');
    expect(await lock()).toBeNull();                                                  // open again until 11 pm: start over
    await seedLock(db, flatId, '2026-10-09T22:30');                                   // before the new lock: nothing saved
    expect(await lock()).toBeNull();
  });

  it('bringing someone back after the lock shows on the plates card as a change after the lock', async () => {
    const { flatId, memberId, tahsin, load } = await flat();
    await db(`update members set left_on = '2026-10-05' where id = $1`, [tahsin]);
    const hc = async () => { const { members, changes } = await load(); return headcount(members, changes, '2026-10-10'); };
    await seedLock(db, flatId, '2026-10-09T22:05');                                  // the action runs this first
    expect(await bringBack(db, flatId, memberId, tahsin, '2026-10-09', '2026-09-01')).toBe('ok');
    expect(countChanges(await countAtLock(db, flatId, '2026-10-10', await hc(), LATE), await hc()))
      .toEqual(['b', 'l', 'd'].map(meal => ({ meal, from: 1, to: 2 })));
  });

  it('no cooking in the gap: the day stays at no meals; cancelling today’s no cooking gives everyone living here today their meal', async () => {
    const { flatId, memberId, tahsin, count } = await flat();
    await db(`update members set left_on = '2026-10-08' where id = $1`, [tahsin]);
    await noCooking(db, flatId, memberId, '2026-10-10', '2026-10-10', ['d'], '2026-10-10');
    await noCooking(db, flatId, memberId, '2026-10-12', '2026-10-12', ['d'], '2026-10-12');
    expect(await bringBack(db, flatId, memberId, tahsin, '2026-10-12', '2026-09-01')).toBe('ok');   // back on the 12th
    expect(await count('2026-10-10', 'd')).toBe(0);    // a past day in the gap: no meals, and only today or later can be un-blocked
    await cookAgain(db, flatId, memberId, '2026-10-12', '2026-10-12', ['d'], '2026-10-12');   // as the action calls it for today
    expect(await count('2026-10-12', 'd')).toBe(1);    // living here today, the cook cooks today: Tahsin eats like everyone
    expect(await count('2026-10-10', 'd')).toBe(0);
  });

  it('sends times and JSON to Postgres as text, which postgres.js passes through untouched', async () => {
    // typed as timestamp, postgres.js reads '2026-10-09T21:00' in the server's time zone (six hours off in Dhaka);
    // typed as json, it encodes a string a second time. PGlite here does neither, so this guards the SQL itself.
    const { readFileSync, readdirSync } = await import('node:fs');
    const files = ['lib', 'app'].flatMap(d => readdirSync(d, { recursive: true, encoding: 'utf8' }).map(f => `${d}/${f}`))
      .filter(f => /[.]tsx?$/.test(f) && !f.endsWith('.test.ts'));
    const bad = files.flatMap(f => (readFileSync(f, 'utf8').match(/[$][0-9]+[ ]*::[ ]*(timestamp|json)/g) ?? []).map(m => `${f}: ${m}`));
    expect(bad).toEqual([]);
  });
});
