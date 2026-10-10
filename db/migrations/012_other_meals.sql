-- Day d is away for member m when the latest (highest id) `|away` audit row whose range covers d is an `away` row,
-- not an `awayCancel` (setAway/cancelAway in lib/meals-db.ts).
create function is_away(f uuid, m uuid, d date) returns boolean language sql stable as $$
  select coalesce((select a.after ? 'away' from audit_log a
    where a.flat_id = f and a.entity_id = m::text || '|away'
      and d between coalesce(a.after->'away'->>0, a.after->'awayCancel'->>0)::date
                and coalesce(a.after->'away'->>1, a.after->'awayCancel'->>1)::date
    order by a.id desc limit 1), false)
$$;

-- Any flatmate can switch another flatmate's own plate before the lock time (spec 2026-10-10-other-meals-design).
-- Three steps, each a fresh read in READ COMMITTED, the whole call one transaction:
-- 1. the flat row FOR NO KEY UPDATE (as 011: never FOR UPDATE, which blocks foreign-key checks): move-outs and handovers
--    take it too, so they have committed or wait;
-- 2. every rule, then a write guarded by the value the person saw (re-checked on the row at write time), guests kept,
--    and its history row only when something was written;
-- 3. a re-check: no cooking, leaving shared meals or going away that committed meanwhile rolls the write and its history back.
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
     or exists (select 1 from no_cook where flat_id = f and date = d and meal = ml) or is_away(f, target, d) then
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
     or not exists (select 1 from members where id = target and in_meals) or is_away(f, target, d) then
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

-- The Home notice looks up one person's meal history rows by entity_id prefix.
create index audit_log_flat_entity on audit_log (flat_id, entity_id text_pattern_ops);

-- No cooking and cook-again save or read the old plates (`old`, the no-cooking snapshot) from the start of their statement.
-- Locked behind the flat row first (as set_usual_meals), they run after any set_other_meal that got there first and see
-- its change, so cook-again never restores a value from before it. Each statement is today's TS statement unchanged.
create function set_no_cook(f uuid, d_from date, d_to date, meals text, log_val jsonb, actor uuid, last_locked date) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with old as (select member_id as m, date::text as d, meal as x, count as c, guests as g from meal_changes
     where flat_id = $1 and date between $2::date and $3::date and meal = any(string_to_array($4::text, ','))),
   up as (insert into meal_changes (flat_id, member_id, date, meal, count, late)
     select m.flat_id, m.id, d::date, x, 0, d::date <= $7::date
     from members m, generate_series($2::text::timestamp, $3::text::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
     where m.flat_id = $1 and m.joined_on <= d::date and (m.left_on is null or d::date <= m.left_on)
     on conflict (member_id, date, meal) do update set count = 0, guests = 0, late = excluded.late, updated_at = now()),
   blocked as (insert into no_cook (flat_id, date, meal)
     select $1, d::date, x from generate_series($2::text::timestamp, $3::text::timestamp, interval '1 day') d, unnest(string_to_array($4::text, ',')) x
     on conflict do nothing)
  insert into audit_log (flat_id, entity, entity_id, before, after, by_member)
  values ($1, 'meal_changes', 'flat|nocook', (select coalesce(jsonb_agg(old), '[]') from old), $5, $6);
end $$;

create function set_cook_again(f uuid, d_from date, d_to date, meals text, log_val jsonb, actor uuid, first_open date) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with unblocked as (delete from no_cook where flat_id = $1 and date between $2::date and $3::date
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
  insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', 'flat|nocook', $5, $6);
end $$;

-- A flatmate's own-meal writes (setOwn, addGuests, removeGuests in lib/meals-db.ts) guard against a no-cooking row,
-- but one statement reads its snapshot before any lock wait, so it can't see a no-cooking save still in flight and
-- would switch the meal back on just as no-cooking commits. The flat row first (as set_no_cook), then the caller's
-- statement, run here so it reads after the lock: no-cooking that got there first is seen and the write is skipped.
-- `q` is the app's own fixed statement, $1..$7 = f, m, d, ml, late, n, eid. True when it wrote a history row.
create function locked_own_write(f uuid, m uuid, d date, ml text, late boolean, n int, eid text, q text) returns boolean language plpgsql as $$
declare k int;
begin
  perform 1 from flats where id = f for no key update;
  execute q using f, m, d, ml, late, n, eid;
  get diagnostics k = row_count;
  return k > 0;
end $$;
