-- Any flatmate can switch another flatmate's own plate before the lock time (spec 2026-10-10-other-meals-design).
-- Three steps, each a fresh read in READ COMMITTED, the whole call one transaction:
-- 1. the flat row FOR NO KEY UPDATE (as 011: never FOR UPDATE, which blocks foreign-key checks): move-outs and handovers
--    take it too, so they have committed or wait;
-- 2. every rule, then a write guarded by the value the person saw (re-checked on the row at write time), guests kept,
--    and its history row only when something was written;
-- 3. a re-check: no cooking or leaving shared meals that committed meanwhile rolls the write and its history back.
create function set_other_meal(f uuid, actor uuid, target uuid, d date, ml text, own int, seen int) returns text language plpgsql as $$
declare
  today date := (now() at time zone 'Asia/Dhaka')::date;
  cut time;
  n int;
begin
  select cutoff_time into cut from flats where id = f for no key update;
  if not found or actor = target or ml not in ('b', 'l', 'd') or own not in (0, 1) or seen not in (0, 1)
     or not exists (select 1 from members where flat_id = f and id = actor and joined_on <= today and (left_on is null or left_on >= today))
     or not exists (select 1 from members where flat_id = f and id = target and in_meals and joined_on <= d and (left_on is null or left_on >= d))
     or d <= today or d > today + 60 or (d = today + 1 and (now() at time zone 'Asia/Dhaka')::time >= cut)
     or exists (select 1 from no_cook where flat_id = f and date = d and meal = ml) then
    return 'closed';
  end if;
  with cur as (select coalesce(
      (select count - guests from meal_changes where member_id = target and date = d and meal = ml),
      (select (case ml when 'b' then default_b when 'l' then default_l else default_d end)::int from members where id = target)) as v),
  old as (select count, guests, late from meal_changes where member_id = target and date = d and meal = ml),
  up as (insert into meal_changes (flat_id, member_id, date, meal, count, guests, late)
      select f, target, d, ml, own, 0, false from cur where cur.v = seen
      on conflict (member_id, date, meal) do update set count = meal_changes.guests + own, late = false, updated_at = now()
        where meal_changes.count - meal_changes.guests = seen
      returning count, guests, late),
  log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
      select f, 'meal_changes', target || '|' || d || '|' || ml, (select to_jsonb(old) from old), to_jsonb(up), actor from up)
  select count(*) into n from up;
  if n = 0 then return 'changed'; end if;
  if exists (select 1 from no_cook where flat_id = f and date = d and meal = ml)
     or not exists (select 1 from members where id = target and in_meals) then
    raise exception 'other_meal_recheck';
  end if;
  return 'ok';
exception when raise_exception then
  if sqlerrm = 'other_meal_recheck' then return 'closed'; end if;
  raise;
end $$;
