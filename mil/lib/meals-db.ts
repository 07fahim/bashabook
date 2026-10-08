import { randomBytes } from 'node:crypto';
import { UUID } from './auth';
import type { Db } from './db';
import { mealDecision, type Decision, type Meal, type MealChange, type MealMember } from './meals';

export type Strictness = 'relaxed' | 'strict';
export type FlatInfo = { name: string; cutoff: string; strictness: Strictness; cookToken: string | null; lang: 'bn' | 'en' };
export type Member = MealMember & { name: string; role: 'member' | 'manager' };
export type HistoryRow = {
  at: Date | string; actor: string | null; who: string | null; entityId: string;
  after: { count?: number; late?: boolean; away?: [string, string]; nocook?: [string, string]; meals?: string };
};
export type SavedChange = MealChange & { late: boolean };
export type MealRequest = { id: string; memberId: string; name: string; date: string; meal: Meal; count: number };

const cell = (c: MealChange) => `${c.memberId}|${c.date}|${c.meal}`;

/** Everything the meal screens need for dates from..to. */
export async function loadMeals(db: Db, flatId: string, from: string, to: string) {
  const [flat] = await db<FlatInfo>(
    `select name, cutoff_time::text as cutoff, strictness, cook_link_token as "cookToken", language as lang from flats where id = $1`, [flatId]);
  const members = await db<Member>(
    `select id, name, role, joined_on::text as "joinedOn", left_on::text as "leftOn",
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
  return { flat, members, changes, requests };
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

/** Applies the flat's lock rule to one change. `now` = nowDhaka(). The person who approves never waits on themselves. */
export async function changeMeal(db: Db, flatId: string, c: MealChange, now: string, selfApprove = false): Promise<Decision> {
  const r = await mealRules(db, flatId);
  const rule = mealDecision(c.date, now, r.cutoff, r.strictness);
  const decision = rule === 'request' && selfApprove ? 'late' : rule;
  if (decision === 'request') await requestMeal(db, flatId, c);
  else if (decision !== 'closed') await saveMeal(db, flatId, c.memberId, c, decision === 'late');
  return decision;
}

/** Past days can't change, so a request for a day before `today` can no longer be decided. */
export async function decideRequest(db: Db, flatId: string, by: string, id: string, approve: boolean, today: string) {
  if (!UUID.test(id)) return false;
  const [r] = await db<MealChange>(
    `update change_requests set status = $4, decided_by = $3
     where flat_id = $1 and id = $2 and entity = 'meal_changes' and status = 'pending' and (payload->>'date')::date >= $5
     returning requested_by as "memberId", payload->>'date' as date, payload->>'meal' as meal, (payload->>'count')::int as count`,
    [flatId, id, by, approve ? 'approved' : 'rejected', today]);
  // ponytail: two statements, not one transaction; a crash between them leaves an approved request unapplied
  if (r && approve) await saveMeal(db, flatId, by, r, true);
  return !!r;
}

/** Away: every meal off from..to, one audit row for the range. */
export async function setAway(db: Db, flatId: string, memberId: string, from: string, to: string) {
  await db(
    `with up as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select $1::uuid, $2::uuid, d::date, m, 0
       from generate_series($3::date, $4::date, interval '1 day') d, unnest(array['b','l','d']) m
       on conflict (member_id, date, meal) do update set count = 0, late = false, updated_at = now())
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', $5, $6, $2)`,
    [flatId, memberId, from, to, `${memberId}|away`, { away: [from, to] }]);
}

/** New usual meals. Every day from joining to freezeTo first keeps the old usual meals as saved rows. */
export async function setDefaults(db: Db, flatId: string, memberId: string, d: Record<Meal, boolean>, freezeTo: string) {
  await db(
    `with frozen as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select m.flat_id, m.id, day::date, x.meal, (case x.meal when 'b' then m.default_b when 'l' then m.default_l else m.default_d end)::int
       from members m, generate_series(m.joined_on, $3::date, interval '1 day') day, unnest(array['b','l','d']) x(meal)
       where m.flat_id = $1 and m.id = $2
       on conflict (member_id, date, meal) do nothing),
     log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select flat_id, 'members', $4, jsonb_build_object('b', default_b, 'l', default_l, 'd', default_d), $5, id
       from members where flat_id = $1 and id = $2)
     update members set default_b = $6, default_l = $7, default_d = $8 where flat_id = $1 and id = $2`,
    [flatId, memberId, freezeTo, `${memberId}|defaults`, d, d.b, d.l, d.d]);
}

export async function updateSettings(db: Db, flatId: string, s: { cutoff: string; strictness: Strictness }) {
  await db(`update flats set cutoff_time = $2, strictness = $3 where id = $1`, [flatId, s.cutoff, s.strictness]);
}

export async function setCookLink(db: Db, flatId: string, on: boolean) {
  await db(`update flats set cook_link_token = $2 where id = $1`, [flatId, on ? randomBytes(24).toString('base64url') : null]);
}

export async function flatIdByCookToken(db: Db, token: string) {
  const [f] = await db<{ id: string }>(`select id from flats where cook_link_token = $1`, [token]);
  return f?.id ?? null;
}

/** No cooking: the chosen meals are off for everyone from..to, waiting requests for them are dropped. One audit row. */
export async function noCooking(db: Db, flatId: string, by: string, from: string, to: string, meals: Meal[]) {
  await db(
    `with up as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select m.flat_id, m.id, d::date, x, 0
       from members m, generate_series($2::date, $3::date, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
       where m.flat_id = $1
       on conflict (member_id, date, meal) do update set count = 0, late = false, updated_at = now()),
     gone as (delete from change_requests where flat_id = $1 and entity = 'meal_changes' and status = 'pending'
       and (payload->>'date')::date between $2::date and $3::date and payload->>'meal' = any(string_to_array($4::text, ',')))
     insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', 'flat|nocook', $5, $6)`,
    [flatId, from, to, meals.join(','), { nocook: [from, to], meals: meals.join(',') }, by]);
}

/** Meal changes worth seeing: late, made for someone else, time away, no cooking. Newest 30. */
export const loadHistory = (db: Db, flatId: string) => db<HistoryRow>(
  `select a.at, actor.name as actor, who.name as who, a.entity_id as "entityId", a.after
   from audit_log a
   left join members actor on actor.id = a.by_member
   left join members who on who.flat_id = a.flat_id and who.id::text = split_part(a.entity_id, '|', 1)
   where a.flat_id = $1 and a.entity = 'meal_changes'
     and (a.entity_id like '%|nocook' or a.entity_id like '%|away' or coalesce((a.after->>'late')::boolean, false)
          or split_part(a.entity_id, '|', 1) <> a.by_member::text)
   order by a.id desc limit 30`, [flatId]);
