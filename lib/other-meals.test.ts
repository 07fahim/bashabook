import { describe, it, expect } from 'vitest';
import { db, migrate } from '../db/test-db';
import { createFlat } from './auth';
import { changedByOthers, loadMeals, setDefaults, setOtherMeal } from './meals-db';
import { headcount } from './meals';
import { loadMonth } from './money-db';

// dates come from the database clock, as the function decides by it
async function flat() {
  await migrate();
  const f = await createFlat(db, { flatName: 'Flat 4B', name: 'Nafis', pin: '1234', others: ['Fahim', 'Tahsin', 'Zarif'], today: '2026-01-01', lang: 'en' });
  const ids = Object.fromEntries((await db<{ id: string; name: string }>(`select id, name from members where flat_id = $1`, [f.flatId])).map(m => [m.name, m.id])) as Record<'Nafis' | 'Fahim' | 'Tahsin' | 'Zarif', string>;
  const [{ today }] = await db<{ today: string }>(`select ((now() at time zone 'Asia/Dhaka')::date)::text as today`);
  const day = async (n: number) => (await db<{ d: string }>(`select ($1::date + $2::int)::text as d`, [today, n]))[0].d;
  await db(`update flats set cutoff_time = '23:59:59' where id = $1`, [f.flatId]);   // tomorrow open unless a test says otherwise
  const set = (actor: string, target: string, date: string, own: 0 | 1, seen: 0 | 1, meal: 'b' | 'l' | 'd' = 'l') =>
    setOtherMeal(db, f.flatId, actor, target, date, meal, own, seen);
  const row = async (target: string, date: string, meal = 'l') =>
    (await db<{ count: number; guests: number }>(`select count, guests from meal_changes where member_id = $1 and date = $2::date and meal = $3`, [target, date, meal]))[0];
  const audits = async (actor: string) =>
    (await db<{ n: number }>(`select count(*)::int as n from audit_log where entity = 'meal_changes' and by_member = $1`, [actor]))[0].n;
  return { flatId: f.flatId, ids, today, day, set, row, audits };
}

describe('changing a flatmate’s meals', { timeout: 30000 }, () => {
  it('allowed before the lock; the history row names the actor and the target, with before and after', async () => {
    const { flatId, ids, day, set, row } = await flat();
    const t = await day(3);
    expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('ok');
    expect(await row(ids.Fahim, t)).toEqual({ count: 0, guests: 0 });
    const [a] = await db<{ by: string; id: string; before: unknown; after: { count: number } }>(
      `select by_member as by, entity_id as id, before, after from audit_log where flat_id = $1 and entity = 'meal_changes' order by id desc limit 1`, [flatId]);
    // `before` is built from the guard, not a second read of the row: the own plate just before the write was exactly
    // `seen` (1, Fahim's usual lunch default), and the write touched no guests (0), so before.count = seen + guests = 1.
    expect([a.by, a.id, a.before, a.after.count]).toEqual([ids.Tahsin, `${ids.Fahim}|${t}|l`, { count: 1, guests: 0 }, 0]);
    expect(await set(ids.Tahsin, ids.Fahim, await day(1), 0, 1)).toBe('ok');   // tomorrow, before the cutoff
  });

  it('refused: after the cutoff, today, past 60 days, no cooking, oneself, a non-member, someone not eating or not living here', async () => {
    const { flatId, ids, today, day, set } = await flat();
    expect(await set(ids.Tahsin, ids.Fahim, today, 0, 1)).toBe('closed');
    expect(await set(ids.Tahsin, ids.Fahim, await day(61), 0, 1)).toBe('closed');
    expect(await set(ids.Tahsin, ids.Tahsin, await day(3), 0, 1)).toBe('closed');
    await db(`update flats set cutoff_time = '00:00' where id = $1`, [flatId]);                     // tomorrow is locked now
    expect(await set(ids.Tahsin, ids.Fahim, await day(1), 0, 1)).toBe('closed');
    const t = await day(4);
    await db(`insert into no_cook (flat_id, date, meal) values ($1, $2::date, 'l')`, [flatId, t]);
    expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('closed');
    const other = await createFlat(db, { flatName: 'Other', name: 'Rafi', pin: '1234', others: [], today: '2026-01-01', lang: 'en' });
    expect(await set(ids.Tahsin, other.memberId, await day(3), 0, 1)).toBe('closed');               // forged: another flat's member
    expect(await set(other.memberId, ids.Fahim, await day(3), 0, 1)).toBe('closed');                // forged: an actor from another flat
    await db(`update members set in_meals = false where id = $1`, [ids.Zarif]);
    expect(await set(ids.Tahsin, ids.Zarif, await day(3), 0, 1)).toBe('closed');                    // cooks for themselves
    await db(`update members set left_on = $2::date where id = $1`, [ids.Fahim, await day(2)]);
    expect(await set(ids.Tahsin, ids.Fahim, await day(3), 0, 1)).toBe('closed');                    // gone by then
  });

  it('refused: an actor who has moved out, or has not joined yet', async () => {
    const { ids, day, set } = await flat();
    await db(`update members set left_on = $2::date where id = $1`, [ids.Tahsin, await day(-1)]);
    expect(await set(ids.Tahsin, ids.Fahim, await day(3), 0, 1)).toBe('closed');
    await db(`update members set left_on = null, joined_on = $2::date where id = $1`, [ids.Tahsin, await day(7)]);
    expect(await set(ids.Tahsin, ids.Fahim, await day(3), 0, 1)).toBe('closed');
  });

  it('stale seen → changed, nothing written, no history; guests are kept', async () => {
    const { ids, day, set, row, audits } = await flat();
    const t = await day(3);
    expect(await set(ids.Tahsin, ids.Fahim, t, 1, 0)).toBe('changed');                // usual lunch is on, Tahsin saw off
    expect([await row(ids.Fahim, t), await audits(ids.Tahsin)]).toEqual([undefined, 0]);
    await db(`insert into meal_changes (flat_id, member_id, date, meal, count, guests)
      select flat_id, id, $2::date, 'l', 3, 2 from members where id = $1`, [ids.Fahim, t]);   // own on + 2 guests
    expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('ok');
    expect(await row(ids.Fahim, t)).toEqual({ count: 2, guests: 2 });
  });

  it('the re-check: no cooking appearing during the write rolls back the change and its history row', async () => {
    const { ids, day, set, row, audits } = await flat();
    const t = await day(3);
    await db(`create function sneak() returns trigger language plpgsql as $$ begin
        insert into no_cook (flat_id, date, meal) values (new.flat_id, new.date, new.meal) on conflict do nothing; return null; end $$`);
    await db(`create trigger sneak after insert on meal_changes for each row execute function sneak()`);
    try {
      expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('closed');
      expect([await row(ids.Fahim, t), await audits(ids.Tahsin)]).toEqual([undefined, 0]);
    } finally {
      await db(`drop trigger sneak on meal_changes`);
      await db(`drop function sneak()`);
    }
  });

  it('the meal count and the bill follow the change', async () => {
    const { flatId, ids, day, set } = await flat();
    const t = await day(3);
    const before = headcount((await loadMeals(db, flatId, t, t)).members, (await loadMeals(db, flatId, t, t)).changes, t).l;
    const month = `${t.slice(0, 7)}-01`;
    // loadMonth only tallies a month's meals up to the `today` it's given (lib/money-db.ts upTo), so a day 3 ahead of the
    // real today needs `t` passed as `today` here to show up in the count; setOtherMeal itself still uses the DB's own clock.
    const mealsBefore = (await loadMonth(db, flatId, month, t)).meals.get(ids.Fahim) ?? 0;
    expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('ok');
    const after = await loadMeals(db, flatId, t, t);
    expect(headcount(after.members, after.changes, t).l).toBe(before - 1);
    expect((await loadMonth(db, flatId, month, t)).meals.get(ids.Fahim) ?? 0).toBeLessThan(mealsBefore);
  });
});

describe('the Home notice', { timeout: 30000 }, () => {
  it('lists someone else’s change to my upcoming meals, only to me; the collector counts as someone else', async () => {
    const { flatId, ids, today, day, set } = await flat();
    const t = await day(3);
    await set(ids.Tahsin, ids.Fahim, t, 0, 1);
    await set(ids.Zarif, ids.Fahim, t, 0, 1, 'd');
    expect(await changedByOthers(db, flatId, ids.Fahim, today)).toEqual([
      { actor: 'Tahsin', date: t, meal: 'l', own: 0 }, { actor: 'Zarif', date: t, meal: 'd', own: 0 }]);
    expect(await changedByOthers(db, flatId, ids.Zarif, today)).toEqual([]);          // unrelated flatmate sees nothing
    await db(`insert into audit_log (flat_id, entity, entity_id, before, after, by_member) values ($1, 'meal_changes', $2, null, $3::text::jsonb, $4)`,
      [flatId, `${ids.Zarif}|${t}|b`, JSON.stringify({ count: 0, guests: 0, late: false }), ids.Nafis]);
    await db(`insert into meal_changes (flat_id, member_id, date, meal, count) values ($1, $2, $3::date, 'b', 0)`, [flatId, ids.Zarif, t]);
    expect((await changedByOthers(db, flatId, ids.Zarif, today)).map(x => x.actor)).toEqual(['Nafis']);   // the collector's fix shows too
  });

  it('goes away after my own change, once the day has passed, when no longer true, and for a refused attempt', async () => {
    const { flatId, ids, today, day, set } = await flat();
    const t = await day(3);
    await set(ids.Tahsin, ids.Fahim, t, 0, 1);
    await db(`with up as (update meal_changes set count = 1, updated_at = now() where member_id = $1 and date = $2::date and meal = 'l' returning count, guests, late)
      insert into audit_log (flat_id, entity, entity_id, before, after, by_member) select $3, 'meal_changes', $1 || '|' || $2 || '|l', '{"count":0,"guests":0}'::jsonb, to_jsonb(up), $1 from up`,
      [ids.Fahim, t, flatId]);                                                          // Fahim switches it back himself
    expect(await changedByOthers(db, flatId, ids.Fahim, today)).toEqual([]);
    await set(ids.Tahsin, ids.Fahim, t, 0, 1);
    expect(await changedByOthers(db, flatId, ids.Fahim, await day(4))).toEqual([]);   // the day has passed
    await db(`update meal_changes set count = 1 where member_id = $1 and date = $2::date and meal = 'l'`, [ids.Fahim, t]);
    expect(await changedByOthers(db, flatId, ids.Fahim, today)).toEqual([]);          // no longer what Tahsin set
    // actual own is 1 (just set above); Zarif's seen (0) is stale, and asking to turn it on (1) isn't a no-op either
    expect(await set(ids.Zarif, ids.Fahim, t, 1, 0)).toBe('changed');                 // refused attempt
    expect((await changedByOthers(db, flatId, ids.Fahim, today)).some(x => x.actor === 'Zarif')).toBe(false);
  });
});

describe('fix round 1', { timeout: 30000 }, () => {
  it('an error other than the re-check is passed on, not turned into closed', async () => {
    const { flatId, ids, day, set } = await flat();
    const t = await day(3);
    const month = `${t.slice(0, 7)}-01`;
    await db(`insert into months (flat_id, month, status) values ($1, $2::date, 'closed')`, [flatId, month]);
    await expect(set(ids.Tahsin, ids.Fahim, t, 0, 1)).rejects.toThrow(/month_closed/);
  });

  it('the re-check also catches in_meals turning off mid-write, rolling back the change and its history row', async () => {
    const { ids, day, set, row, audits } = await flat();
    const t = await day(3);
    await db(`create function sneak_in_meals() returns trigger language plpgsql as $$ begin
        update members set in_meals = false where id = new.member_id; return null; end $$`);
    await db(`create trigger sneak_in_meals after insert on meal_changes for each row execute function sneak_in_meals()`);
    try {
      expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('closed');
      expect([await row(ids.Fahim, t), await audits(ids.Tahsin)]).toEqual([undefined, 0]);
    } finally {
      await db(`drop trigger sneak_in_meals on meal_changes`);
      await db(`drop function sneak_in_meals()`);
    }
  });

  it('forged values are closed with nothing written', async () => {
    const { flatId, ids, day, row, audits } = await flat();
    const t = await day(3);
    const raw = async (f: string | null, actor: string | null, target: string | null, date: string | null, meal: string | null, own: number | null, seen: number | null) =>
      (await db<{ r: string }>(`select set_other_meal($1, $2, $3, $4::date, $5, $6, $7) as r`, [f, actor, target, date, meal, own, seen]))[0].r;
    expect(await raw(flatId, ids.Tahsin, ids.Fahim, t, 'x', 0, 1)).toBe('closed');     // bad meal code
    expect(await raw(flatId, ids.Tahsin, ids.Fahim, t, 'l', 2, 1)).toBe('closed');     // own out of range (2, 2 would be caught as a no-op instead)
    expect(await raw(flatId, ids.Tahsin, ids.Fahim, t, 'l', 0, 2)).toBe('closed');     // seen out of range
    expect(await raw(flatId, ids.Tahsin, ids.Fahim, null, 'l', 0, 1)).toBe('closed');  // a null argument
    expect([await row(ids.Fahim, t), await audits(ids.Tahsin)]).toEqual([undefined, 0]);
  });

  it('day 60 is still open, day 61 is already refused', async () => {
    const { ids, day, set } = await flat();
    expect(await set(ids.Tahsin, ids.Fahim, await day(60), 0, 1)).toBe('ok');
    expect(await set(ids.Tahsin, ids.Fahim, await day(61), 0, 1)).toBe('closed');
  });

  it('no-op: asking for the value already seen writes nothing and raises no notice', async () => {
    const { flatId, ids, today, day, set, row, audits } = await flat();
    const t = await day(3);
    expect(await set(ids.Tahsin, ids.Fahim, t, 1, 1)).toBe('closed');
    expect([await row(ids.Fahim, t), await audits(ids.Tahsin)]).toEqual([undefined, 0]);
    expect(await changedByOthers(db, flatId, ids.Fahim, today)).toEqual([]);
  });

  it('setDefaults and setOtherMeal are serialized (run one after another here: PGlite cannot hold two transactions open at once, so this proves the ordering is correct, not the lock itself)', async () => {
    const { flatId, ids, day, set, row } = await flat();
    const t = await day(3);
    // Fahim turns lunch off in their usual meals and starts cooking for themselves
    await setDefaults(db, flatId, ids.Fahim, { b: true, l: false, d: true }, await day(-2), await day(-1), false);
    expect(await set(ids.Tahsin, ids.Fahim, t, 0, 1)).toBe('closed');   // the in_meals rule refuses it, whichever order the two writes land in

    // the other way round: setOtherMeal writes a plain row first, then leaving shared meals must see and clear it
    const u = await day(5);
    await setDefaults(db, flatId, ids.Zarif, { b: true, l: false, d: true }, await day(-2), await day(-1), true);   // lunch default off, still in shared meals
    expect(await set(ids.Tahsin, ids.Zarif, u, 1, 0)).toBe('ok');       // turns lunch on: a plain row, count 1, no guests
    expect(await row(ids.Zarif, u)).toEqual({ count: 1, guests: 0 });
    await setDefaults(db, flatId, ids.Zarif, { b: true, l: false, d: true }, await day(-2), await day(-1), false);   // now leaves shared meals
    expect(await row(ids.Zarif, u)).toBeUndefined();   // cleared: set_usual_meals locked the flat row first, so it saw the row set_other_meal just wrote
  });
});
