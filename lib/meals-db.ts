import type { Db } from './db';
import { addDays, countChanges, headcount, indexChanges, isLocked, isPresent, mealCount, mealDecision, type Decision, type Meal, type MealChange, type MealMember } from './meals';

export type FlatInfo = {
  name: string; cutoff: string; lang: 'bn' | 'en'; weights: Record<Meal, number>;
};
export type Member = MealMember & { name: string; role: 'member' | 'manager'; inMeals: boolean };
export type HistoryRow = {
  at: Date | string; actor: string | null; who: string | null; entity: 'meal_changes' | 'members' | 'flats' | 'cook' | 'rooms' | 'bill_templates'; entityId: string;
  before?: { guests?: number; count?: number; rent_share_poisha?: number; roomId?: string | null; room?: string | null; name?: string; amount_poisha?: number } | null;
  after: {
    count?: number; guests?: number; late?: boolean;
    away?: [string, string]; awayCancel?: [string, string];
    nocook?: [string, string]; cookAgain?: [string, string]; meals?: string;
    b?: boolean; l?: boolean; d?: boolean; inMeals?: boolean; rename?: [string, string]; left?: string | null; back?: [string, string]; added?: string;
    pinReset?: boolean; admin?: string; codeChanged?: boolean;   // admin: the app team reset it (the reason stays out of the app)
    locked?: number;   // wrong PIN tries when the sign-in was locked for good
    lockCleared?: boolean;   // a flatmate cleared the lock; the PIN stayed
    cutoff?: string; weights?: Record<Meal, number>;
    told?: string; plates?: Record<Meal, number>;
    name?: string; rent_share_poisha?: number; roomId?: string | null; room?: string | null; fixFor?: string[];   // rooms
    amount_poisha?: number; removed?: boolean;   // bill_templates (monthly bills)
  };
};
export type SavedChange = MealChange & { guests: number; late: boolean };
export type NoCook = { date: string; meal: Meal };

const cell = (c: MealChange) => `${c.memberId}|${c.date}|${c.meal}`;

/** Everything the meal screens need for dates from..to. */
export async function loadMeals(db: Db, flatId: string, from: string, to: string) {
  // four independent reads at once: one round trip instead of four, on every page
  const [[flat], members, changes, noCook] = await Promise.all([
    db<FlatInfo>(
      `select name, cutoff_time::text as cutoff, language as lang,
         json_build_object('b', weight_b, 'l', weight_l, 'd', weight_d) as weights
       from flats where id = $1`, [flatId]),
    db<Member>(
      `select id, name, role, in_meals as "inMeals", joined_on::text as "joinedOn", left_on::text as "leftOn",
         json_build_object('b', default_b, 'l', default_l, 'd', default_d) as defaults
       from members where flat_id = $1 order by name`, [flatId]),
    db<SavedChange>(
      `select member_id as "memberId", date::text as date, meal, count, guests, late
       from meal_changes where flat_id = $1 and date between $2 and $3`, [flatId, from, to]),
    db<NoCook>(`select date::text as date, meal from no_cook where flat_id = $1 and date between $2 and $3`, [flatId, from, to]),
  ]);
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
         where (meal_changes.count, meal_changes.guests) <> (excluded.count, excluded.guests)
       returning count, guests, late)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'meal_changes', $7, (select to_jsonb(old) from old), to_jsonb(up), $8 from up`,   // a repeated tap writes nothing, no second history line
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

const blocked = async (db: Db, flatId: string, date: string, meal: Meal) =>
  (await db(`select 1 from no_cook where flat_id = $1 and date = $2::text::date and meal = $3`, [flatId, date, meal])).length > 0;

/** The lock rule for one of my changes. `now` = nowDhaka(). No-cooking meals are closed to members. */
const decide = async (db: Db, flatId: string, date: string, meal: Meal, now: string): Promise<Decision> =>
  (await blocked(db, flatId, date, meal)) ? 'closed' : mealDecision(date, now, (await mealRules(db, flatId)).cutoff);

/** My own write, relative to the saved row, so it never undoes a flatmate's change made after my screen loaded.
 *  `up` writes only when something changes and returns count, guests, late and `b`, the plates before (null for a new
 *  row) rebuilt from the written row; the history row goes in the same statement, only when `up` wrote. $6 = `n`.
 *  It runs inside locked_own_write (migration 012), behind the flat row, so its no-cooking guard sees a no-cooking
 *  save that got there first. */
const writeMine = async (db: Db, flatId: string, memberId: string, date: string, meal: Meal, late: boolean, n: number, up: string) =>
  (await db<{ ok: boolean }>(`select locked_own_write($1, $2, $3::text::date, $4, $5, $6, $7, $8) as ok`,
    [flatId, memberId, date, meal, late, n, `${memberId}|${date}|${meal}`,
     `with up as (${up})
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'meal_changes', $7, b, jsonb_build_object('count', count, 'guests', guests, 'late', late), $2 from up`]))[0].ok;

/** A meal chip: switches only my own plate; my guests stay. */
export async function setOwn(db: Db, flatId: string, memberId: string, date: string, meal: Meal, own: 0 | 1, now: string): Promise<Decision> {
  if (!(await currentPlates(db, flatId, memberId, date, meal))) return 'closed';
  const decision = await decide(db, flatId, date, meal, now);
  if (decision === 'closed') return decision;
  // the guard below closes the gap between the decide() read and this write: a no-cooking row inserted in between is
  // caught here too, so the meal never switches on for a day no-cooking has just taken
  const wrote = await writeMine(db, flatId, memberId, date, meal, decision === 'late', own,
    `insert into meal_changes (flat_id, member_id, date, meal, count, guests, late)
       select $1, $2, $3::text::date, $4, $6, 0, $5
       where not exists (select 1 from no_cook where flat_id = $1 and date = $3::text::date and meal = $4)
     on conflict (member_id, date, meal) do update set count = $6 + meal_changes.guests, late = $5, updated_at = now()
       where meal_changes.count - meal_changes.guests <> $6
         and not exists (select 1 from no_cook where flat_id = $1 and date = $3::text::date and meal = $4)
     -- on the update path the matched row is locked first, so xmax is never 0; only a fresh insert leaves xmax = 0,
     -- which is how the audit's before column tells a new row (null) from one that already existed
     returning count, guests, late, case when xmax = 0 then null else jsonb_build_object('count', guests + 1 - $6, 'guests', guests) end as b`);
  if (!wrote && await blocked(db, flatId, date, meal)) return 'closed';
  return decision;
}

/** Removes all my guests from one meal; my own plate stays. Today and earlier are closed to members (the flat's starter can).
 *  Only the guests my read saw (so history says how many went): if they changed meanwhile, nothing is written. */
export async function removeGuests(db: Db, flatId: string, memberId: string, date: string, meal: Meal, now: string): Promise<Decision> {
  const p = await currentPlates(db, flatId, memberId, date, meal);
  if (!p || p.guests === 0) return 'closed';
  const decision = await decide(db, flatId, date, meal, now);
  if (decision === 'closed') return decision;
  // the guard below closes the gap between the decide() read and this write: a no-cooking row inserted in between is
  // caught here too, so the removal never fires for a day no-cooking has just taken
  const wrote = await writeMine(db, flatId, memberId, date, meal, decision === 'late', p.guests,
    `update meal_changes set count = count - guests, guests = 0, late = $5, updated_at = now()
     where flat_id = $1 and member_id = $2 and date = $3::text::date and meal = $4 and guests = $6
       and not exists (select 1 from no_cook where flat_id = $1 and date = $3::text::date and meal = $4)
     returning count, guests, late, jsonb_build_object('count', count + $6, 'guests', $6) as b`);
  if (!wrote && await blocked(db, flatId, date, meal)) return 'closed';
  return decision;
}

/** My meals with guests from `from` on, for the guest list. */
export const myGuests = (db: Db, flatId: string, memberId: string, from: string) => db<{ date: string; meal: Meal; guests: number }>(
  `select date::text as date, meal, guests from meal_changes where flat_id = $1 and member_id = $2 and date >= $3 and guests > 0
   order by date, position(meal in 'bld')`, [flatId, memberId, from]);

/** Guests for one of my meals: always added on top of my current plates (at least 1); my own plate never changes.
 *  Later days follow the usual lock rule. Today (surprise guests) is allowed too, saved as late so it shows in history. */
/** `key`: the form's one-time key. The guests are a delta, so a resubmit after a lost response (same key) must not add them
 *  again: a key already in `sent_jobs` means the guests are in, and a key is recorded only once the write has happened.
 *  ponytail: the write and its claim are two statements, so a crash between them lets a resubmit add once more (the old
 *  behaviour, never a silent loss); one statement would need a new column on meal_changes. */
export async function addGuests(db: Db, flatId: string, memberId: string, date: string, meal: Meal, guests: number, now: string, key?: string): Promise<Decision | 'full'> {
  if (guests < 1 || date < now.slice(0, 10)) return 'closed';
  const claim = [flatId, date, `guests:${key}`];
  if (key && (await db(`select 1 from sent_jobs where flat_id = $1 and date = $2::text::date and job_type = $3`, claim)).length) return 'open';
  const r = await addGuestsOnce(db, flatId, memberId, date, meal, guests, now);
  if (key && r !== 'closed' && r !== 'full') await db(`insert into sent_jobs (flat_id, date, job_type) values ($1, $2::text::date, $3) on conflict do nothing`, claim);
  return r;
}

async function addGuestsOnce(db: Db, flatId: string, memberId: string, date: string, meal: Meal, guests: number, now: string): Promise<Decision | 'full'> {
  if (!(await currentPlates(db, flatId, memberId, date, meal))) return 'closed';
  const decision = date !== now.slice(0, 10) ? await decide(db, flatId, date, meal, now) : (await blocked(db, flatId, date, meal)) ? 'closed' : 'late';
  if (decision === 'closed') return decision;
  // at most 9 guests, so a meal never passes 10 plates; a new row starts from my usual meal. The not-exists guard
  // closes the gap between the decide()/blocked() read above and this write: a no-cooking row inserted in between
  // is caught here too, so guests never land on a day no-cooking has just taken
  const wrote = await writeMine(db, flatId, memberId, date, meal, decision === 'late', guests,
    `insert into meal_changes (flat_id, member_id, date, meal, count, guests, late)
     select $1, $2, $3::text::date, $4::text, (case $4::text when 'b' then default_b when 'l' then default_l else default_d end)::int + $6, $6, $5
     from members where id = $2 and $6 <= 9
       and not exists (select 1 from no_cook where flat_id = $1 and date = $3::text::date and meal = $4)
     on conflict (member_id, date, meal) do update set count = meal_changes.count + $6, guests = meal_changes.guests + $6, late = $5, updated_at = now()
       where meal_changes.guests + $6 <= 9
         and not exists (select 1 from no_cook where flat_id = $1 and date = $3::text::date and meal = $4)
     -- on the update path the matched row is locked first, so xmax is never 0; only a fresh insert leaves xmax = 0,
     -- which is how the audit's before column tells a new row (null) from one that already existed
     returning count, guests, late, case when xmax = 0 then null else jsonb_build_object('count', count - $6, 'guests', guests - $6) end as b`);
  if (wrote) return decision;
  return (await blocked(db, flatId, date, meal)) ? 'closed' : 'full';
}

/** Away: every meal off from..to, one audit row for the range. */
/** Returns the booked guests it dropped (read before the update: every part of one statement sees the same snapshot). */
export async function setAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  return db<{ date: string; meal: Meal; guests: number }>(
    `with dropped as (select date::text as date, meal, guests from meal_changes
       where flat_id = $1 and member_id = $2 and date between $3::date and $4::date and guests > 0),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select $1::uuid, $2::uuid, d::date, m, 0
       from generate_series($3::text::timestamp, $4::text::timestamp, interval '1 day') d, unnest(array['b','l','d']) m
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

/** New usual meals. Days freezeFrom..freezeTo first keep the old usual meals as saved rows, so locked days don't move;
 *  `freezeFrom` null = from the day they joined (no month closed yet, so every month is open).
 *  `inMeals = false` (cooking for yourself) also clears plain future rows, so booked meals don't keep counting.
 *  The members update fires touch_open_months, which (since migration 014) locks the open months in month order, the same
 *  order the frozen rows lock them in, so two such writes at once can't deadlock. */
export async function setDefaults(db: Db, flatId: string, memberId: string, d: Record<Meal, boolean>, freezeFrom: string | null, freezeTo: string, inMeals: boolean | null = null) {
  // set_usual_meals (migration 012) locks the flat row first, so this always runs after any set_other_meal that got
  // there first (and before any that starts after): leaving shared meals never misses a row set_other_meal just wrote.
  await db(
    `select set_usual_meals($1, $2, $3::text::date, $4::text::date, $5, $6::text::jsonb, $7, $8, $9, $10)`,
    [flatId, memberId, freezeFrom, freezeTo, `${memberId}|defaults`, JSON.stringify(inMeals === null ? d : { ...d, inMeals }), d.b, d.l, d.d, inMeals]);
}

export const isInMeals = async (db: Db, flatId: string, memberId: string) =>
  (await db<{ v: boolean }>(`select in_meals as v from members where flat_id = $1 and id = $2`, [flatId, memberId]))[0]?.v ?? false;

/** Weights are hundredths of a meal (breakfast 50 = 0.5) and apply to every day of the open month. Audited with the old values. */
/** `now` = nowDhaka(). If the new lock time opens tomorrow again, tomorrow's after-the-lock tracking starts over;
 *  if tomorrow stays locked, the baseline stays (the cook may already have been told).
 *  New meal weights re-price every open month, so while a month that has ended is still open they are refused ('earlier')
 *  unless `fix` says they deliberately correct it; the history row then names that month. In the same statement as the change. */
export async function updateSettings(db: Db, flatId: string, by: string, s: { cutoff: string; weights: Record<Meal, number> }, now: string, fix = false): Promise<'ok' | 'earlier'> {
  const reopened = !isLocked(addDays(now.slice(0, 10), 1), now, s.cutoff);
  const [r] = await db<{ blocked: boolean }>(
    `with
     -- the ended months still open, locked so a close running now finishes first and its month drops out (see addRoom)
     ended as (select month from months where flat_id = $1 and status = 'open' and month < date_trunc('month', $9::text::date)
       order by month for no key update),
     -- the flat row first, then the months, the order the ledger writers of 011 and 012 take (otherwise a lock-time save and a
     -- September entry at the same moment deadlock). fl runs inside g, before up, so it never meets a row up already changed.
     fl as (select 1 from flats where id = $1 for no key update),
     g as (select exists (select 1 from fl) and not $10::boolean and exists (select 1 from ended) as ask),
     -- The old values come from the flat row this update locks (never a separate locking read: it may run after up and skip
     -- the row up changed). Whether the weights change is checked on the updated row itself, which Postgres checks again
     -- against the newest version after waiting: this statement's snapshot may predate a change saved at the same moment.
     -- (select ask from g) is not null is always true and names no row: Postgres works out g once, before reading the flat row.
     up as (update flats f set cutoff_time = $2, weight_b = $3, weight_l = $4, weight_d = $5,
       lock_date = case when $8::boolean then null else f.lock_date end, lock_count = case when $8::boolean then null else f.lock_count end
       from (select id, cutoff_time, weight_b, weight_l, weight_d from flats where id = $1 for no key update) o
       where f.id = o.id and (select ask from g) is not null
         and not ((select ask from g) and (f.weight_b, f.weight_l, f.weight_d) is distinct from ($3::int, $4::int, $5::int))
       returning o.cutoff_time::text as cutoff, json_build_object('b', o.weight_b, 'l', o.weight_l, 'd', o.weight_d) as weights,
         (o.weight_b, o.weight_l, o.weight_d) is distinct from ($3::int, $4::int, $5::int) as reweigh),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select $1, 'flats', 'flat|settings', jsonb_build_object('cutoff', up.cutoff, 'weights', up.weights),
         $6::text::jsonb || case when $10::boolean and up.reweigh and exists (select 1 from ended)
           then jsonb_build_object('fixFor', (select jsonb_agg(month::text order by month) from ended)) else '{}'::jsonb end, $7
       from up)
     select not exists (select 1 from up) as blocked`,
    [flatId, s.cutoff, s.weights.b, s.weights.l, s.weights.d, JSON.stringify(s), by, reopened, now.slice(0, 10), fix]);
  return r.blocked ? 'earlier' : 'ok';
}

/** No cooking: the chosen meals are off for everyone living in the flat from..to, and members can't switch them on.
 *  One audit row keeps the old saved values. Days up to `lastLocked` are marked late. */
export async function noCooking(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], lastLocked: string) {
  // set_no_cook (migration 012) locks the flat row first, so its snapshot of the old plates includes any flatmate's change that got there first
  await db(`select set_no_cook($1, $2::text::date, $3::text::date, $4, $5::text::jsonb, $6, $7::text::date)`,
    [flatId, from, to, meals.join(','), JSON.stringify({ nocook: [from, to], meals: meals.join(',') }), by, lastLocked]);
}

/** The cook is back early: unblock from..to. From `firstOpen` on, each blocked meal still at the no-cooking 0 goes back to
 *  what it was before no cooking (away, an Off, guest plates) or, if nothing was saved, to the usual meal.
 *  ponytail: takes the newest no-cooking snapshot per meal; two overlapping no-cooking ranges without a cook-again between
 *  would restore the first one's zeros. */
export async function cookAgain(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], firstOpen: string) {
  // set_cook_again (migration 012): the same flat lock first, then the statement with a fresh snapshot
  await db(`select set_cook_again($1, $2::text::date, $3::text::date, $4, $5::text::jsonb, $6, $7::text::date)`,
    [flatId, from, to, meals.join(','), JSON.stringify({ cookAgain: [from, to], meals: meals.join(',') }), by, firstOpen]);
}

/** The flat's first move-in day: meals start there. */
export const flatStart = async (db: Db, flatId: string) =>
  (await db<{ start: string }>(`select min(joined_on)::text as start from members where flat_id = $1`, [flatId]))[0].start;

/** Changes worth seeing: late, made for someone else, away, no cooking, usual meals, meal rules, rooms and rent shares, and
 *  monthly bills started or stopped. The newest `limit` (the page asks for one more to know whether older ones exist).
 *  `mine` keeps my own meals plus flat-wide rows; every room, rent and monthly bill change can move my rent, so it stays. */
export const loadHistory = (db: Db, flatId: string, mine: string | null = null, limit = 50) => db<HistoryRow>(
  `select a.at, actor.name as actor, who.name as who, a.entity, a.entity_id as "entityId", a.after, a.before
   from audit_log a
   left join members actor on actor.id = a.by_member
   left join members who on who.flat_id = a.flat_id and who.id::text = split_part(a.entity_id, '|', 1)
   where a.flat_id = $1
     and (a.entity in ('members', 'flats', 'cook', 'rooms', 'bill_templates')
          or (a.entity = 'meal_changes' and (a.entity_id like 'flat|%' or a.entity_id like '%|away'
              or coalesce((a.after->>'guests')::int, 0) <> coalesce((a.before->>'guests')::int, 0)   -- every guest change is worth seeing
              or coalesce((a.after->>'late')::boolean, false) or split_part(a.entity_id, '|', 1) <> a.by_member::text)))
     and ($2::text is null or a.entity_id like 'flat|%' or a.entity in ('rooms', 'bill_templates') or split_part(a.entity_id, '|', 1) = $2::text)
   order by a.id desc limit $3::int`, [flatId, mine, limit]);

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
  // $3 goes in as text: typed as jsonb, postgres.js would JSON-encode the string a second time. $4 too: typed as a
  // timestamp, postgres.js turns '2026-10-09T21:00' into a Date in the server's own time zone and sends it as UTC, so on a
  // machine set to Dhaka the lock check ran six hours late and a change after the lock never showed.
  const [r] = await db<{ c: Record<Meal, number> }>(
    `update flats set lock_count = case when lock_date is distinct from $2::date then $3::text::jsonb else lock_count end, lock_date = $2::date
     where id = $1 and $4::text::timestamp >= ($2::date - 1) + cutoff_time returning lock_count as c`, [flatId, date, JSON.stringify(hc), now]);
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

/** Another flatmate switches someone's own plate (guests stay). Every rule, the lock and the stale check are inside the
 *  database function (migration 012), so a forged request can't get round them. `seen` = the own plate the screen showed. */
export async function setOtherMeal(db: Db, flatId: string, actor: string, target: string, date: string, meal: Meal, own: 0 | 1, seen: 0 | 1) {
  const [r] = await db<{ r: 'ok' | 'changed' | 'closed' }>(`select set_other_meal($1, $2, $3, $4::text::date, $5, $6, $7) as r`, [flatId, actor, target, date, meal, own, seen]);
  return r.r;
}

/** My upcoming meals (from `today`) whose latest change was made by someone else and still stands: the Home notice.
 *  Only own-plate changes: the own plate before (my usual meal when no row was saved) must differ from the one set, so a
 *  guest-only fix by the collector isn't listed. A later away of mine covering the day hides it. */
export const changedByOthers = (db: Db, flatId: string, me: string, today: string) => db<{ actor: string; date: string; meal: Meal; own: number }>(
  `select actor.name as actor, split_part(a.entity_id, '|', 2) as date, split_part(a.entity_id, '|', 3) as meal,
     (a.after->>'count')::int - coalesce((a.after->>'guests')::int, 0) as own
   from (select distinct on (split_part(entity_id, '|', 2), split_part(entity_id, '|', 3)) id, entity_id, by_member, before, after
         from audit_log
         where flat_id = $1 and entity = 'meal_changes' and entity_id like $2::text || '|%' and split_part(entity_id, '|', 1) = $2::text
           and entity_id ~ '^[^|]+\\|\\d{4}-\\d{2}-\\d{2}\\|[bld]$' and split_part(entity_id, '|', 2) >= $3
         order by split_part(entity_id, '|', 2), split_part(entity_id, '|', 3), id desc) a
   join members actor on actor.id = a.by_member
   join members self on self.id = $2::uuid
   join meal_changes mc on mc.member_id = $2::uuid and mc.date = split_part(a.entity_id, '|', 2)::date and mc.meal = split_part(a.entity_id, '|', 3)
   where a.by_member <> $2::uuid
     and mc.count - mc.guests = (a.after->>'count')::int - coalesce((a.after->>'guests')::int, 0)
     and coalesce((a.before->>'count')::int - coalesce((a.before->>'guests')::int, 0),
           (case split_part(a.entity_id, '|', 3) when 'b' then self.default_b when 'l' then self.default_l else self.default_d end)::int)
         <> (a.after->>'count')::int - coalesce((a.after->>'guests')::int, 0)
     and not exists (select 1 from audit_log w where w.flat_id = $1 and w.entity_id = $2::text || '|away' and w.id > a.id
           and split_part(a.entity_id, '|', 2) between w.after->'away'->>0 and w.after->'away'->>1)
   order by 2, position(split_part(a.entity_id, '|', 3) in 'bld')`, [flatId, me, today]);
