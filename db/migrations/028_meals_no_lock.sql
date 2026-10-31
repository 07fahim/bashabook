-- Meals have no lock time any more (spec 2026-10-31-meal-no-lock-design): a flatmate may switch another flatmate's own
-- plate for today too, saved as a same-day change (late). Only the date rule and the late flag change from 012; every other
-- check, the lock order, the stale guard and the re-check stay as they were. flats.cutoff_time stays in the table, unread.
create or replace function set_other_meal(f uuid, actor uuid, target uuid, d date, ml text, own int, seen int) returns text language plpgsql as $$
declare
  today date := (now() at time zone 'Asia/Dhaka')::date;
  n int;
begin
  if f is null or actor is null or target is null or d is null or ml is null or own is null or seen is null then return 'closed'; end if;
  perform 1 from flats where id = f for no key update;
  if not found or actor = target or own = seen or ml not in ('b', 'l', 'd') or own not in (0, 1) or seen not in (0, 1)
     or not exists (select 1 from members where flat_id = f and id = actor and joined_on <= today and (left_on is null or left_on >= today))
     or not exists (select 1 from members where flat_id = f and id = target and in_meals and joined_on <= d and (left_on is null or left_on >= d))
     or d < today or d > today + 60
     or exists (select 1 from no_cook where flat_id = f and date = d and meal = ml) or is_away(f, target, d) then
    return 'closed';
  end if;
  -- the guard already proves the own plate before the write was exactly `seen`; `before` is built from that, not a
  -- second read of the row (which could be stale under concurrency), so it always matches what the guard checked.
  with cur as (select coalesce(
      (select count - guests from meal_changes where member_id = target and date = d and meal = ml),
      (select (case ml when 'b' then default_b when 'l' then default_l else default_d end)::int from members where id = target)) as v),
  up as (insert into meal_changes (flat_id, member_id, date, meal, count, guests, late)
      select f, target, d, ml, own, 0, d = today from cur where cur.v = seen
      on conflict (member_id, date, meal) do update set count = meal_changes.guests + own, late = excluded.late, updated_at = now()
        where meal_changes.count - meal_changes.guests = seen
      returning count, guests, late),
  log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
      select f, 'meal_changes', target || '|' || d || '|' || ml, jsonb_build_object('count', up.guests + seen, 'guests', up.guests), to_jsonb(up), actor from up)
  select count(*) into n from up;
  if n = 0 then return 'changed'; end if;
  if exists (select 1 from no_cook where flat_id = f and date = d and meal = ml)
     or not exists (select 1 from members where id = target and in_meals) or is_away(f, target, d) then
    raise exception 'other_meal_recheck';
  end if;
  return 'ok';
exception when raise_exception then
  if sqlerrm = 'other_meal_recheck' then return 'closed'; end if;
  raise;
end $$;
