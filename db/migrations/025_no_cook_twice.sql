-- No cooking saved again over days that are already blocked (a longer range re-entered, or a form sent twice) snapshotted the
-- first save's zeros as "the plates before no cooking", and cook-again (newest snapshot wins) brought back 0 for everyone.
-- A meal already blocked is no longer snapshotted, so the first save's snapshot stays the one cook-again restores.
create or replace function set_no_cook(f uuid, d_from date, d_to date, meals text, log_val jsonb, actor uuid, last_locked date) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with old as (select member_id as m, date::text as d, meal as x, count as c, guests as g from meal_changes
     where flat_id = $1 and date between $2::date and $3::date and meal = any(string_to_array($4::text, ','))
       and not exists (select 1 from no_cook n where n.flat_id = $1 and n.date = meal_changes.date and n.meal = meal_changes.meal)),
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
