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
  if f is null or actor is null or target is null or d is null or ml is null or own is null or seen is null then return 'closed'; end if;
  select cutoff_time into cut from flats where id = f for no key update;
  if not found or actor = target or own = seen or ml not in ('b', 'l', 'd') or own not in (0, 1) or seen not in (0, 1)
     or not exists (select 1 from members where flat_id = f and id = actor and joined_on <= today and (left_on is null or left_on >= today))
     or not exists (select 1 from members where flat_id = f and id = target and in_meals and joined_on <= d and (left_on is null or left_on >= d))
     or d <= today or d > today + 60 or (d = today + 1 and (now() at time zone 'Asia/Dhaka')::time >= cut)
     or exists (select 1 from no_cook where flat_id = f and date = d and meal = ml) then
    return 'closed';
  end if;
  -- the guard already proves the own plate before the write was exactly `seen`; `before` is built from that, not a
  -- second read of the row (which could be stale under concurrency), so it always matches what the guard checked.
  with cur as (select coalesce(
      (select count - guests from meal_changes where member_id = target and date = d and meal = ml),
      (select (case ml when 'b' then default_b when 'l' then default_l else default_d end)::int from members where id = target)) as v),
  up as (insert into meal_changes (flat_id, member_id, date, meal, count, guests, late)
      select f, target, d, ml, own, 0, false from cur where cur.v = seen
      on conflict (member_id, date, meal) do update set count = meal_changes.guests + own, late = false, updated_at = now()
        where meal_changes.count - meal_changes.guests = seen
      returning count, guests, late),
  log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
      select f, 'meal_changes', target || '|' || d || '|' || ml, jsonb_build_object('count', up.guests + seen, 'guests', up.guests), to_jsonb(up), actor from up)
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

-- setDefaults's statement (leaving shared meals clears/zeroes future plain rows) reads its own snapshot from the start
-- of its statement. Without a lock first, it can run at the same moment as set_other_meal, miss the row set_other_meal
-- just inserted, and leave that person billed for a meal they've just switched to cooking for themselves. Locking the
-- flat row first (never FOR UPDATE, same reason as set_other_meal) serialises the two: whichever commits first is the
-- one the other sees.
create function set_usual_meals(f uuid, mem uuid, freeze_from date, freeze_to date, entity_id text, log_val jsonb, d_b boolean, d_l boolean, d_d boolean, p_in_meals boolean) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with frozen as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select m.flat_id, m.id, day::date, x.meal, (case x.meal when 'b' then m.default_b when 'l' then m.default_l else m.default_d end)::int
       from members m, generate_series(greatest(m.joined_on, freeze_from)::timestamp, freeze_to::timestamp, interval '1 day') day, unnest(array['b','l','d']) x(meal)
       where m.flat_id = f and m.id = mem
       on conflict (member_id, date, meal) do nothing),
   cleared as (delete from meal_changes where flat_id = f and member_id = mem and date > freeze_to and count = 1 and guests = 0 and p_in_meals = false),
   own_off as (update meal_changes set count = guests, updated_at = now()
       where flat_id = f and member_id = mem and date > freeze_to and guests > 0 and count > guests and p_in_meals = false),
   log as (insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
       select flat_id, 'members', entity_id, jsonb_build_object('b', default_b, 'l', default_l, 'd', default_d, 'inMeals', in_meals), log_val, id
       from members where flat_id = f and id = mem)
  update members set default_b = d_b, default_l = d_l, default_d = d_d, in_meals = coalesce(p_in_meals, in_meals)
  where flat_id = f and id = mem;
end $$;
