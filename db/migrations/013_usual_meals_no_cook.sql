-- set_usual_meals (012) saves the old usual meals into locked days before they change, but it wrote the usual meal even on a
-- no-cooking meal. Someone who moved in after no-cooking was set has no row there (it counts 0); once the day passed, changing
-- their usual meals saved a 1 and billed a meal that was never cooked. A no-cooking meal is now saved as 0, as freezeMonth
-- (lib/close.ts) does. Only that line changes; existing rows are never touched (on conflict do nothing, as before).
create or replace function set_usual_meals(f uuid, mem uuid, freeze_from date, freeze_to date, entity_id text, log_val jsonb, d_b boolean, d_l boolean, d_d boolean, p_in_meals boolean) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with frozen as (insert into meal_changes (flat_id, member_id, date, meal, count)
       select m.flat_id, m.id, day::date, x.meal,
         case when exists (select 1 from no_cook n where n.flat_id = m.flat_id and n.date = day::date and n.meal = x.meal) then 0
              else (case x.meal when 'b' then m.default_b when 'l' then m.default_l else m.default_d end)::int end
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
