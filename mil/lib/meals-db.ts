import { randomBytes } from 'node:crypto';
import { UUID } from './auth';
import type { Db } from './db';
import { mealDecision, type Decision, type Meal, type MealChange, type MealMember } from './meals';

export type Strictness = 'relaxed' | 'strict';
export type FlatInfo = { name: string; cutoff: string; strictness: Strictness; cookToken: string | null; lang: 'bn' | 'en'; weights: Record<Meal, number> };
export type Member = MealMember & { name: string; role: 'member' | 'manager'; inMeals: boolean };
export type HistoryRow = {
  at: Date | string; actor: string | null; who: string | null; entity: 'meal_changes' | 'members' | 'flats'; entityId: string;
  after: {
    count?: number; late?: boolean; rejected?: boolean;
    away?: [string, string]; awayCancel?: [string, string];
    nocook?: [string, string]; cookAgain?: [string, string]; meals?: string;
    b?: boolean; l?: boolean; d?: boolean; inMeals?: boolean;
    cutoff?: string; weights?: Record<Meal, number>;
  };
};
export type SavedChange = MealChange & { late: boolean };
export type MealRequest = { id: string; memberId: string; name: string; date: string; meal: Meal; count: number };
export type NoCook = { date: string; meal: Meal };

const cell = (c: MealChange) => `${c.memberId}|${c.date}|${c.meal}`;

/** Everything the meal screens need for dates from..to. */
export async function loadMeals(db: Db, flatId: string, from: string, to: string) {
  const [flat] = await db<FlatInfo>(
    `select name, cutoff_time::text as cutoff, strictness, cook_link_token as "cookToken", language as lang,
       json_build_object('b', weight_b, 'l', weight_l, 'd', weight_d) as weights
     from flats where id = $1`, [flatId]);
  const members = await db<Member>(
    `select id, name, role, in_meals as "inMeals", joined_on::text as "joinedOn", left_on::text as "leftOn",
       json_build_object('b', default_b, 'l', default_l, 'd', default_d) as defaults
     from members where flat_id = $1 order by name`, [flatId]);
  const changes = await db<SavedChange>(
    `select member_id as "memberId", date::text as date, meal, count, late
     from meal_changes where flat_id = $1 and date between $2 and $3`, [flatId, from, to]);
  const requests = await db<MealRequest>(
    `select r.id, r.requested_by as "memberId", m.name, r.payload->>'date' as date, r.payload->>'meal' as meal, (r.payload->>'count')::int as count
     from change_requests r join members m on m.id = r.requested_by
     where r.flat_id = $1 and r.entity = 'meal_changes' and r.status = 'pending' and (r.payload->>'date')::date >= $2
     order by r.created_at`, [flatId, from]);
  const noCook = await db<NoCook>(`select date::text as date, meal from no_cook where flat_id = $1 and date between $2 and $3`, [flatId, from, to]);
  return { flat, members, changes, requests, noCook };
}

export const mealRules = async (db: Db, flatId: string) =>
  (await db<{ cutoff: string; strictness: Strictness }>(`select cutoff_time::text as cutoff, strictness from flats where id = $1`, [flatId]))[0];

/** Saves one meal change and its audit row in one statement. A direct save also drops any waiting request for that meal. */
export async function saveMeal(db: Db, flatId: string, by: string, c: MealChange, late: boolean) {
  await db(
    `with old as (select count, late from meal_changes where member_id = $2 and date = $3 and meal = $4),
     gone as (delete from change_requests where flat_id = $1 and entity = 'meal_changes' and entity_id = $7 and status = 'pending'),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count, late) values ($1, $2, $3, $4, $5, $6)
       on conflict (member_id, date, meal) do update set count = excluded.count, late = excluded.late, updated_at = now()
       returning count, late)
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     select $1, 'meal_changes', $7, (select to_jsonb(old) from old), to_jsonb(up), $8 from up`,
    [flatId, c.memberId, c.date, c.meal, c.count, late, cell(c), by]);
}

/** Strict mode after the lock: one pending request per meal, the newest wins. */
export async function requestMeal(db: Db, flatId: string, c: MealChange) {
  await db(
    `with gone as (delete from change_requests where flat_id = $1 and entity = 'meal_changes' and entity_id = $2 and status = 'pending')
     insert into change_requests (flat_id, entity, entity_id, payload, requested_by) values ($1, 'meal_changes', $2, $3, $4)`,
    [flatId, cell(c), { date: c.date, meal: c.meal, count: c.count }, c.memberId]);
}

/** The count that counts today: the saved row, else the usual meal. */
async function currentCount(db: Db, c: MealChange) {
  const [r] = await db<{ n: number }>(
    `select coalesce((select count from meal_changes where member_id = $1 and date = $2 and meal = $3),
       (case $3::text when 'b' then default_b when 'l' then default_l else default_d end)::int) as n
     from members where id = $1`, [c.memberId, c.date, c.meal]);
  return r.n;
}

/** Applies the flat's lock rule to one change. `now` = nowDhaka(). The person who approves never waits on themselves.
 *  No-cooking days are closed to members. A request that matches what is already saved just drops the waiting one. */
export async function changeMeal(db: Db, flatId: string, c: MealChange, now: string, selfApprove = false): Promise<Decision> {
  const r = await mealRules(db, flatId);
  const blocked = (await db(`select 1 from no_cook where flat_id = $1 and date = $2 and meal = $3`, [flatId, c.date, c.meal])).length > 0;
  const rule = blocked ? 'closed' : mealDecision(c.date, now, r.cutoff, r.strictness);
  const decision = rule === 'request' && selfApprove ? 'late' : rule;
  if (decision === 'request' && c.count === (await currentCount(db, c))) {
    await db(`delete from change_requests where flat_id = $1 and entity = 'meal_changes' and entity_id = $2 and status = 'pending'`, [flatId, cell(c)]);
    return 'open';
  }
  if (decision === 'request') await requestMeal(db, flatId, c);
  else if (decision !== 'closed') await saveMeal(db, flatId, c.memberId, c, decision === 'late');
  return decision;
}

/** Past days can't change, so a request for a day before `today` can no longer be decided. Rejections are audited too. */
export async function decideRequest(db: Db, flatId: string, by: string, id: string, approve: boolean, today: string) {
  if (!UUID.test(id)) return false;
  const [r] = await db<MealChange>(
    `update change_requests set status = $4, decided_by = $3
     where flat_id = $1 and id = $2 and entity = 'meal_changes' and status = 'pending' and (payload->>'date')::date >= $5
     returning requested_by as "memberId", payload->>'date' as date, payload->>'meal' as meal, (payload->>'count')::int as count`,
    [flatId, id, by, approve ? 'approved' : 'rejected', today]);
  // ponytail: two statements, not one transaction; a crash between them leaves an approved request unapplied
  if (r && approve) await saveMeal(db, flatId, by, r, true);
  if (r && !approve) {
    await db(`insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $2, $3, $4)`,
      [flatId, cell(r), { count: r.count, rejected: true }, by]);
  }
  return !!r;
}

/** Away: every meal off from..to, one audit row for the range. */
export async function setAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  await db(
    `with up as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select $1::uuid, $2::uuid, d::date, m, 0
       from generate_series($3::timestamp, $4::timestamp, interval '1 day') d, unnest(array['b','l','d']) m
       on conflict (member_id, date, meal) do update set count = 0, late = false, updated_at = now())
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $5, $6, $2)`,
    [flatId, memberId, from, to, `${memberId}|away`, { away: [from, to] }]);
}

/** Cancels away from..to: the zeroed meals go back to the usual meals. `from` must already be an open day. */
export async function cancelAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  await db(
    `with gone as (delete from meal_changes where flat_id = $1 and member_id = $2 and date between $3::date and $4::date and count = 0)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $5, $6, $2)`,
    [flatId, memberId, from, to, `${memberId}|away`, { awayCancel: [from, to] }]);
}

/** Away ranges that still reach today or later and were not cancelled after. */
export async function upcomingAway(db: Db, flatId: string, memberId: string, today: string) {
  const rows = await db<{ after: HistoryRow['after'] }>(
    `select after from audit_log where flat_id = $1 and entity_id = $2 order by id`, [flatId, `${memberId}|away`]);
  const out: [string, string][] = [];
  for (const { after } of rows) {
    if (after.away && after.away[1] >= today) out.push(after.away);
    if (after.awayCancel) {
      const [f, t] = after.awayCancel;
      for (let i = out.length - 1; i >= 0; i--) if (out[i][0] <= t && out[i][1] >= f) out.splice(i, 1);
    }
  }
  return out;
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
     cleared as (delete from meal_changes where flat_id = $1 and member_id = $2 and date > $4::date and count <= 1 and $10::boolean = false),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select flat_id, 'members', $5, jsonb_build_object('b', default_b, 'l', default_l, 'd', default_d, 'inMeals', in_meals), $6, id
       from members where flat_id = $1 and id = $2)
     update members set default_b = $7, default_l = $8, default_d = $9, in_meals = coalesce($10::boolean, in_meals)
     where flat_id = $1 and id = $2`,
    [flatId, memberId, freezeFrom, freezeTo, `${memberId}|defaults`, inMeals === null ? d : { ...d, inMeals }, d.b, d.l, d.d, inMeals]);
}

/** Cooking for yourself: usual meals all off, booked plain meals after the lock cleared. Back = all on. */
export const setInMeals = (db: Db, flatId: string, memberId: string, on: boolean, freezeFrom: string, freezeTo: string) =>
  setDefaults(db, flatId, memberId, { b: on, l: on, d: on }, freezeFrom, freezeTo, on);

export const isInMeals = async (db: Db, flatId: string, memberId: string) =>
  (await db<{ v: boolean }>(`select in_meals as v from members where flat_id = $1 and id = $2`, [flatId, memberId]))[0]?.v ?? false;

/** Weights are hundredths of a meal (breakfast 50 = 0.5) and apply to every day of the open month. Audited with the old values. */
export async function updateSettings(db: Db, flatId: string, by: string, s: { cutoff: string; strictness: Strictness; weights: Record<Meal, number> }) {
  await db(
    `with old as (select cutoff_time::text as cutoff, strictness, json_build_object('b', weight_b, 'l', weight_l, 'd', weight_d) as weights from flats where id = $1),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member) select $1, 'flats', 'flat|settings', to_jsonb(old), $7, $8 from old)
     update flats set cutoff_time = $2, strictness = $3, weight_b = $4, weight_l = $5, weight_d = $6 where id = $1`,
    [flatId, s.cutoff, s.strictness, s.weights.b, s.weights.l, s.weights.d, s, by]);
}

export async function setCookLink(db: Db, flatId: string, on: boolean) {
  await db(`update flats set cook_link_token = $2 where id = $1`, [flatId, on ? randomBytes(24).toString('base64url') : null]);
}

export async function flatIdByCookToken(db: Db, token: string) {
  const [f] = await db<{ id: string }>(`select id from flats where cook_link_token = $1`, [token]);
  return f?.id ?? null;
}

/** No cooking: the chosen meals are off for everyone living in the flat from..to, and members can't switch them on.
 *  Waiting requests for them are dropped. One audit row keeps the old saved values. Days up to `lastLocked` are marked late. */
export async function noCooking(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], lastLocked: string) {
  await db(
    `with old as (select member_id as m, date::text as d, meal as x, count as c from meal_changes
       where flat_id = $1 and date between $2::date and $3::date and meal = any(string_to_array($4::text, ','))),
     up as (insert into meal_changes (flat_id, member_id, date, meal, count, late)
       select m.flat_id, m.id, d::date, x, 0, d::date <= $7::date
       from members m, generate_series($2::timestamp, $3::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
       where m.flat_id = $1 and m.joined_on <= d::date and (m.left_on is null or d::date <= m.left_on)
       on conflict (member_id, date, meal) do update set count = 0, late = excluded.late, updated_at = now()),
     blocked as (insert into no_cook (flat_id, date, meal)
       select $1, d::date, x from generate_series($2::timestamp, $3::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
       on conflict do nothing),
     gone as (delete from change_requests where flat_id = $1 and entity = 'meal_changes' and status = 'pending'
       and (payload->>'date')::date between $2::date and $3::date and payload->>'meal' = any(string_to_array($4::text, ',')))
     insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
     values ($1, 'meal_changes', 'flat|nocook', (select coalesce(jsonb_agg(old), '[]') from old), $5, $6)`,
    [flatId, from, to, meals.join(','), { nocook: [from, to], meals: meals.join(',') }, by, lastLocked]);
}

/** The cook is back early: unblock from..to, and from `firstOpen` on everyone's switched-off meals return to their usual meals. */
export async function cookAgain(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[], firstOpen: string) {
  await db(
    `with unblocked as (delete from no_cook where flat_id = $1 and date between $2::date and $3::date and meal = any(string_to_array($4::text, ','))),
     restored as (delete from meal_changes where flat_id = $1 and date between greatest($2::date, $7::date) and $3::date
       and meal = any(string_to_array($4::text, ',')) and count = 0)
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', 'flat|nocook', $5, $6)`,
    [flatId, from, to, meals.join(','), { cookAgain: [from, to], meals: meals.join(',') }, by, firstOpen]);
}

/** Changes worth seeing: late, made for someone else, away, no cooking, usual meals and meal rules. Newest 50.
 *  `mine` keeps my own meals plus flat-wide rows. */
export const loadHistory = (db: Db, flatId: string, mine: string | null = null) => db<HistoryRow>(
  `select a.at, actor.name as actor, who.name as who, a.entity, a.entity_id as "entityId", a.after
   from audit_log a
   left join members actor on actor.id = a.by_member
   left join members who on who.flat_id = a.flat_id and who.id::text = split_part(a.entity_id, '|', 1)
   where a.flat_id = $1
     and (a.entity in ('members', 'flats')
          or (a.entity = 'meal_changes' and (a.entity_id like 'flat|%' or a.entity_id like '%|away'
              or coalesce((a.after->>'late')::boolean, false) or split_part(a.entity_id, '|', 1) <> a.by_member::text)))
     and ($2::text is null or a.entity_id like 'flat|%' or split_part(a.entity_id, '|', 1) = $2::text)
   order by a.id desc limit 50`, [flatId, mine]);
