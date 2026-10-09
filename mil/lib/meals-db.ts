import { randomBytes } from 'node:crypto';
import type { Db } from './db';
import { addDays, countChanges, headcount, indexChanges, isLocked, isPresent, mealCount, mealDecision, type Decision, type Meal, type MealChange, type MealMember } from './meals';

export type FlatInfo = {
  name: string; cutoff: string; cookToken: string | null; lang: 'bn' | 'en'; weights: Record<Meal, number>;
};
export type Member = MealMember & { name: string; role: 'member' | 'manager'; inMeals: boolean };
export type HistoryRow = {
  at: Date | string; actor: string | null; who: string | null; entity: 'meal_changes' | 'members' | 'flats' | 'cook'; entityId: string;
  before?: { guests?: number; count?: number } | null;
  after: {
    count?: number; guests?: number; late?: boolean;
    away?: [string, string]; awayCancel?: [string, string];
    nocook?: [string, string]; cookAgain?: [string, string]; meals?: string;
    b?: boolean; l?: boolean; d?: boolean; inMeals?: boolean; rename?: [string, string]; left?: string | null; back?: [string, string];
    cutoff?: string; weights?: Record<Meal, number>;
    told?: string; plates?: Record<Meal, number>;
  };
};
export type SavedChange = MealChange & { guests: number; late: boolean };
export type NoCook = { date: string; meal: Meal };

const cell = (c: MealChange) => `${c.memberId}|${c.date}|${c.meal}`;

/** Everything the meal screens need for dates from..to. */
export async function loadMeals(db: Db, flatId: string, from: string, to: string) {
  const [flat] = await db<FlatInfo>(
    `select name, cutoff_time::text as cutoff, cook_link_token as "cookToken", language as lang,
       json_build_object('b', weight_b, 'l', weight_l, 'd', weight_d) as weights
     from flats where id = $1`, [flatId]);
  const members = await db<Member>(
    `select id, name, role, in_meals as "inMeals", joined_on::text as "joinedOn", left_on::text as "leftOn",
       json_build_object('b', default_b, 'l', default_l, 'd', default_d) as defaults
     from members where flat_id = $1 order by name`, [flatId]);
  const changes = await db<SavedChange>(
    `select member_id as "memberId", date::text as date, meal, count, guests, late
     from meal_changes where flat_id = $1 and date between $2 and $3`, [flatId, from, to]);
  const noCook = await db<NoCook>(`select date::text as date, meal from no_cook where flat_id = $1 and date between $2 and $3`, [flatId, from, to]);
  // A no-cooking meal counts 0 for everyone without a saved row, whatever deleted or never wrote one (cancelled away,
  // someone moving in later). Saved rows win, so the starter can still override. Money must load meals through here.
  const saved = new Set(changes.map(c => `${c.memberId}|${c.date}|${c.meal}`));
  for (const n of noCook) for (const m of members) {
    if (!saved.has(`${m.id}|${n.date}|${n.meal}`)) changes.push({ memberId: m.id, date: n.date, meal: n.meal, count: 0, guests: 0, late: false });
  }
  return { flat, members, changes, noCook };
}

export const mealRules = async (db: Db, flatId: string) =>
  (await db<{ cutoff: string }>(`select cutoff_time::text as cutoff from flats where id = $1`, [flatId]))[0];

/** Saves one meal change (total plates and the guests inside them) and its audit row in one statement. */
export async function saveMeal(db: Db, flatId: string, by: string, c: MealChange & { guests: number }, late: boolean) {
  await db(
    `with old as (select count, guests, late from meal_changes where member_id = $2 and date = $3 and meal = $4),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count, guests, late) values ($1, $2, $3, $4, $5, $9, $6)
       on conflict (member_id, date, meal) do update set count = excluded.count, guests = excluded.guests, late = excluded.late, updated_at = now()
       returning count, guests, late)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'meal_changes', $7, (select to_jsonb(old) from old), to_jsonb(up), $8 from up
     where not exists (select 1 from old where old.count = up.count and old.guests = up.guests)`,   // a repeated tap writes no second history line
    [flatId, c.memberId, c.date, c.meal, c.count, late, cell(c), by, c.guests]);
}

/** Someone's plates for one meal: own (0 or 1, from their usual meals when nothing is saved) and guests. Null if not living here. */
export async function currentPlates(db: Db, flatId: string, memberId: string, date: string, meal: Meal) {
  const { members, changes } = await loadMeals(db, flatId, date, date);
  const self = members.find(m => m.id === memberId);
  if (!self || !isPresent(self, date)) return null;
  const guests = changes.find(c => c.memberId === memberId && c.date === date && c.meal === meal)?.guests ?? 0;
  return { own: mealCount(self, indexChanges(changes), date, meal) - guests, guests };
}

/** Applies the lock rule to one of my changes. `now` = nowDhaka(). No-cooking meals are closed to members. */
export async function changeMeal(db: Db, flatId: string, c: MealChange, now: string): Promise<Decision> {
  const r = await mealRules(db, flatId);
  const blocked = (await db(`select 1 from no_cook where flat_id = $1 and date = $2 and meal = $3`, [flatId, c.date, c.meal])).length > 0;
  const decision = blocked ? 'closed' : mealDecision(c.date, now, r.cutoff);
  if (decision !== 'closed') await saveMeal(db, flatId, c.memberId, { ...c, guests: c.guests ?? 0 }, decision === 'late');
  return decision;
}

/** A meal chip: switches only my own plate; my guests stay. Same read-then-write note as addGuests. */
export async function setOwn(db: Db, flatId: string, memberId: string, date: string, meal: Meal, own: 0 | 1, now: string): Promise<Decision> {
  const p = await currentPlates(db, flatId, memberId, date, meal);
  if (!p) return 'closed';
  return changeMeal(db, flatId, { memberId, date, meal, count: own + p.guests, guests: p.guests }, now);
}

/** Removes all my guests from one meal; my own plate stays. Today and earlier are closed to members (the flat's starter can). */
export async function removeGuests(db: Db, flatId: string, memberId: string, date: string, meal: Meal, now: string): Promise<Decision> {
  const p = await currentPlates(db, flatId, memberId, date, meal);
  if (!p || p.guests === 0) return 'closed';
  return changeMeal(db, flatId, { memberId, date, meal, count: p.own, guests: 0 }, now);
}

/** My meals with guests from `from` on, for the guest list. */
export const myGuests = (db: Db, flatId: string, memberId: string, from: string) => db<{ date: string; meal: Meal; guests: number }>(
  `select date::text as date, meal, guests from meal_changes where flat_id = $1 and member_id = $2 and date >= $3 and guests > 0
   order by date, position(meal in 'bld')`, [flatId, memberId, from]);

/** Guests for one of my meals: always added on top of my current plates (at least 1); my own plate never changes.
 *  Later days follow the usual lock rule. Today (surprise guests) is allowed too, saved as late so it shows in history. */
export async function addGuests(db: Db, flatId: string, memberId: string, date: string, meal: Meal, guests: number, now: string): Promise<Decision | 'full'> {
  if (guests < 1 || date < now.slice(0, 10)) return 'closed';
  if ((await db(`select 1 from no_cook where flat_id = $1 and date = $2 and meal = $3`, [flatId, date, meal])).length) return 'closed';
  const p = await currentPlates(db, flatId, memberId, date, meal);
  if (!p) return 'closed';
  if (p.guests + guests > 9) return 'full';   // at most 9 guests, so a meal never passes 10 plates
  // ponytail: read then write, so two taps at the same moment can lose one guest; both still leave a history row
  const c = { memberId, date, meal, count: p.own + p.guests + guests, guests: p.guests + guests };
  if (date !== now.slice(0, 10)) return changeMeal(db, flatId, c, now);
  await saveMeal(db, flatId, memberId, c, true);
  return 'late';
}

/** Away: every meal off from..to, one audit row for the range. */
/** Returns the booked guests it dropped (read before the update: every part of one statement sees the same snapshot). */
export async function setAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  return db<{ date: string; meal: Meal; guests: number }>(
    `with dropped as (select date::text as date, meal, guests from meal_changes
       where flat_id = $1 and member_id = $2 and date between $3::date and $4::date and guests > 0),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select $1::uuid, $2::uuid, d::date, m, 0
       from generate_series($3::timestamp, $4::timestamp, interval '1 day') d, unnest(array['b','l','d']) m
       on conflict (member_id, date, meal) do update set count = 0, guests = 0, late = false, updated_at = now()),
     log as (insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $5, $6, $2))
     select * from dropped order by date, position(meal in 'bld')`,
    [flatId, memberId, from, to, `${memberId}|away`, { away: [from, to] }]);
}

/** Cancels away from..to: the zeroed meals go back to the usual meals. `from` must already be an open day. */
export async function cancelAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  await db(
    `with gone as (delete from meal_changes where flat_id = $1 and member_id = $2 and date between $3::date and $4::date and count = 0)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $5, $6, $2)`,
    [flatId, memberId, from, to, `${memberId}|away`, { awayCancel: [from, to] }]);
}

/** Away ranges still reaching `today` or later, minus cancelled days, overlapping ranges merged. */
export async function upcomingAway(db: Db, flatId: string, memberId: string, today: string) {
  const rows = await db<{ after: HistoryRow['after'] }>(
    `select after from audit_log where flat_id = $1 and entity_id = $2 order by id`, [flatId, `${memberId}|away`]);
  let ranges: [string, string][] = [];
  for (const { after } of rows) {
    if (after.away) ranges.push(after.away);
    if (after.awayCancel) {
      const [f, t] = after.awayCancel;
      ranges = ranges.flatMap(([a, b]): [string, string][] =>
        b < f || a > t ? [[a, b]] : [...(a < f ? [[a, addDays(f, -1)] as [string, string]] : []), ...(b > t ? [[addDays(t, 1), b] as [string, string]] : [])]);
    }
  }
  const merged: [string, string][] = [];
  for (const [a, b] of ranges.filter(r => r[1] >= today).sort((x, y) => x[0].localeCompare(y[0]))) {
    const last = merged.at(-1);
    if (last && a <= addDays(last[1], 1)) last[1] = b > last[1] ? b : last[1];
    else merged.push([a, b]);
  }
  return merged;
}

/** New usual meals. Days freezeFrom..freezeTo first keep the old usual meals as saved rows, so locked days don't move.
 *  `inMeals = false` (cooking for yourself) also clears plain future rows, so booked meals don't keep counting. */
export async function setDefaults(db: Db, flatId: string, memberId: string, d: Record<Meal, boolean>, freezeFrom: string, freezeTo: string, inMeals: boolean | null = null) {
  await db(
    `with frozen as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select m.flat_id, m.id, day::date, x.meal, (case x.meal when 'b' then m.default_b when 'l' then m.default_l else m.default_d end)::int
       from members m, generate_series(greatest(m.joined_on, $3::date)::timestamp, $4::timestamp, interval '1 day') day, unnest(array['b','l','d']) x(meal)
       where m.flat_id = $1 and m.id = $2
       on conflict (member_id, date, meal) do nothing),
     cleared as (delete from meal_changes where flat_id = $1 and member_id = $2 and date > $4::date and count = 1 and guests = 0 and $10::boolean = false),
     own_off as (update meal_changes set count = guests, updated_at = now()
       where flat_id = $1 and member_id = $2 and date > $4::date and guests > 0 and count > guests and $10::boolean = false),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select flat_id, 'members', $5, jsonb_build_object('b', default_b, 'l', default_l, 'd', default_d, 'inMeals', in_meals), $6, id
       from members where flat_id = $1 and id = $2)
     update members set default_b = $7, default_l = $8, default_d = $9, in_meals = coalesce($10::boolean, in_meals)
     where flat_id = $1 and id = $2`,
    [flatId, memberId, freezeFrom, freezeTo, `${memberId}|defaults`, inMeals === null ? d : { ...d, inMeals }, d.b, d.l, d.d, inMeals]);
}

export const isInMeals = async (db: Db, flatId: string, memberId: string) =>
  (await db<{ v: boolean }>(`select in_meals as v from members where flat_id = $1 and id = $2`, [flatId, memberId]))[0]?.v ?? false;

/** Weights are hundredths of a meal (breakfast 50 = 0.5) and apply to every day of the open month. Audited with the old values. */
/** `now` = nowDhaka(). If the new lock time opens tomorrow again, tomorrow's after-the-lock tracking starts over;
 *  if tomorrow stays locked, the baseline stays (the cook may already have been told). */
export async function updateSettings(db: Db, flatId: string, by: string, s: { cutoff: string; weights: Record<Meal, number> }, now: string) {
  const reopened = !isLocked(addDays(now.slice(0, 10), 1), now, s.cutoff);
  await db(
    `with old as (select cutoff_time::text as cutoff, json_build_object('b', weight_b, 'l', weight_l, 'd', weight_d) as weights from flats where id = $1),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member) select $1, 'flats', 'flat|settings', to_jsonb(old), $6, $7 from old)
     update flats set cutoff_time = $2, weight_b = $3, weight_l = $4, weight_d = $5,
       lock_date = case when $8::boolean then null else lock_date end, lock_count = case when $8::boolean then null else lock_count end
     where id = $1`,
    [flatId, s.cutoff, s.weights.b, s.weights.l, s.weights.d, s, by, reopened]);
}

export async function setCookLink(db: Db, flatId: string, on: boolean) {
  await db(`update flats set cook_link_token = $2 where id = $1`, [flatId, on ? randomBytes(24).toString('base64url') : null]);
}

export async function flatIdByCookToken(db: Db, token: string) {
  const [f] = await db<{ id: string }>(`select id from flats where cook_link_token = $1`, [token]);
  return f?.id ?? null;
}

/** No cooking: the chosen meals are off for everyone living in the flat from..to, and members can't switch them on.
 *  One audit row keeps the old saved values. Days up to `lastLocked` are marked late. */
export async function noCooking(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], lastLocked: string) {
  await db(
    `with old as (select member_id as m, date::text as d, meal as x, count as c, guests as g from meal_changes
       where flat_id = $1 and date between $2::date and $3::date and meal = any(string_to_array($4::text, ','))),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count, late)
       select m.flat_id, m.id, d::date, x, 0, d::date <= $7::date
       from members m, generate_series($2::timestamp, $3::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
       where m.flat_id = $1 and m.joined_on <= d::date and (m.left_on is null or d::date <= m.left_on)
       on conflict (member_id, date, meal) do update set count = 0, guests = 0, late = excluded.late, updated_at = now()),
     blocked as (insert into no_cook (flat_id, date, meal)
       select $1, d::date, x from generate_series($2::timestamp, $3::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
       on conflict do nothing)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     values ($1, 'meal_changes', 'flat|nocook', (select coalesce(jsonb_agg(old), '[]') from old), $5, $6)`,
    [flatId, from, to, meals.join(','), { nocook: [from, to], meals: meals.join(',') }, by, lastLocked]);
}

/** The cook is back early: unblock from..to. From `firstOpen` on, each blocked meal still at the no-cooking 0 goes back to
 *  what it was before no cooking (away, an Off, guest plates) or, if nothing was saved, to the usual meal.
 *  ponytail: takes the newest no-cooking snapshot per meal; two overlapping no-cooking ranges without a cook-again between
 *  would restore the first one's zeros. */
export async function cookAgain(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], firstOpen: string) {
  await db(
    `with unblocked as (delete from no_cook where flat_id = $1 and date between $2::date and $3::date
       and meal = any(string_to_array($4::text, ',')) returning date, meal),
     snap as (select distinct on (e->>'m', e->>'d', e->>'x') (e->>'m')::uuid as m, (e->>'d')::date as d, e->>'x' as x, (e->>'c')::int as c,
         coalesce((e->>'g')::int, greatest((e->>'c')::int - 1, 0)) as g   -- snapshots from before 004 had no guests
       from audit_log a, jsonb_array_elements(a.before) e
       where a.flat_id = $1 and a.entity_id = 'flat|nocook' and jsonb_typeof(a.before) = 'array'
       order by e->>'m', e->>'d', e->>'x', a.id desc),
     back as (update meal_changes mc set count = s.c, guests = s.g, updated_at = now() from unblocked u, snap s
       where mc.flat_id = $1 and mc.date = u.date and mc.meal = u.meal and mc.date >= $7::date and mc.count = 0
         and s.m = mc.member_id and s.d = mc.date and s.x = mc.meal),
     plain as (delete from meal_changes mc using unblocked u
       where mc.flat_id = $1 and mc.date = u.date and mc.meal = u.meal and mc.date >= $7::date and mc.count = 0
         and not exists (select 1 from snap s where s.m = mc.member_id and s.d = mc.date and s.x = mc.meal))
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', 'flat|nocook', $5, $6)`,
    [flatId, from, to, meals.join(','), { cookAgain: [from, to], meals: meals.join(',') }, by, firstOpen]);
}

/** Changes worth seeing: late, made for someone else, away, no cooking, usual meals and meal rules. Newest 50.
 *  `mine` keeps my own meals plus flat-wide rows. */
export const loadHistory = (db: Db, flatId: string, mine: string | null = null) => db<HistoryRow>(
  `select a.at, actor.name as actor, who.name as who, a.entity, a.entity_id as "entityId", a.after, a.before
   from audit_log a
   left join members actor on actor.id = a.by_member
   left join members who on who.flat_id = a.flat_id and who.id::text = split_part(a.entity_id, '|', 1)
   where a.flat_id = $1
     and (a.entity in ('members', 'flats', 'cook')
          or (a.entity = 'meal_changes' and (a.entity_id like 'flat|%' or a.entity_id like '%|away'
              or coalesce((a.after->>'guests')::int, 0) <> coalesce((a.before->>'guests')::int, 0)   -- every guest change is worth seeing
              or coalesce((a.after->>'late')::boolean, false) or split_part(a.entity_id, '|', 1) <> a.by_member::text)))
     and ($2::text is null or a.entity_id like 'flat|%' or split_part(a.entity_id, '|', 1) = $2::text)
   order by a.id desc limit 50`, [flatId, mine]);

/** Days from `from` on with no cooking, and which meals. */
export const loadNoCookDays = (db: Db, flatId: string, from: string) => db<{ date: string; meals: string }>(
  `select date::text as date, string_agg(meal, ',' order by position(meal in 'bld')) as meals
   from no_cook where flat_id = $1 and date >= $2 group by date order by date`, [flatId, from]);

/** Tomorrow's count as first seen after the lock time. The first call for `date` saves `hc`; later calls return the saved one,
 *  so comparing it with the live count catches every change after the lock, whatever caused it (deleted rows, new members).
 *  Called after the lock by the cards, and by every meal-changing action through `seedLock`. */
export async function countAtLock(db: Db, flatId: string, date: string, hc: Record<Meal, number>, now: string) {
  // One statement: under concurrency the CASE sees the row the other request just wrote, and the lock check reads the
  // flat's current lock time, so a lock time saved at the same moment is never missed. Not locked yet: no baseline, `hc` back.
  // $3 goes in as text: typed as jsonb, postgres.js would JSON-encode the string a second time.
  const [r] = await db<{ c: Record<Meal, number> }>(
    `update flats set lock_count = case when lock_date is distinct from $2::date then $3::text::jsonb else lock_count end, lock_date = $2::date
     where id = $1 and $4::timestamp >= ($2::date - 1) + cutoff_time returning lock_count as c`, [flatId, date, JSON.stringify(hc), now]);
  return r?.c ?? hc;
}

/** Every server action that changes meals or members calls this first: if tomorrow is already locked, it saves tomorrow's
 *  count as the baseline before the change, so the change shows on the cards even if nobody looked after the lock. */
export async function seedLock(db: Db, flatId: string, now: string) {
  const tomorrow = addDays(now.slice(0, 10), 1);
  if (!isLocked(tomorrow, now, (await mealRules(db, flatId)).cutoff)) return;   // most taps: one query, nothing saved
  const { members, changes } = await loadMeals(db, flatId, tomorrow, tomorrow);
  await countAtLock(db, flatId, tomorrow, headcount(members, changes, tomorrow), now);
}

/** Someone told the cook the count their card showed: that count becomes the baseline, so the warning goes for everyone.
 *  Only if their screen still shows the live count: an out-of-date tap changes nothing, so no change is hidden and no false alarm appears.
 *  Only for the day the baseline belongs to: a page left open since yesterday changes nothing. */
export async function toldCook(db: Db, flatId: string, by: string, date: string, seen: Record<Meal, number>) {
  const { members, changes } = await loadMeals(db, flatId, date, date);
  // the screen was out of date: change nothing (no false alarm, no hidden change); the page then shows the new count
  if (countChanges(seen, headcount(members, changes, date)).length) return false;
  // the history line lets everyone see who said they told the cook, and which count; a repeat of the same count writes none
  const r = await db(
    `with f as (update flats set lock_count = $4::text::jsonb where id = $1 and lock_date = $3::date and lock_count is distinct from $4::text::jsonb returning id)
     insert into audit_log (flat_id, entity, entity_id, after, by_member)
     select $1, 'cook', 'flat|told', jsonb_build_object('told', $3::date, 'plates', $4::text::jsonb), $2 from f returning 1`,
    [flatId, by, date, JSON.stringify(seen)]);
  return r.length > 0;
}
