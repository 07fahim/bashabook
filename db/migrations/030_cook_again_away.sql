-- Cook again puts back the plates from before no cooking (the snapshot). Two fixes, same signature (the app is unchanged,
-- either deploy order is safe):
-- 1. It skipped anyone away that day, so an away saved during the block stays off; that also skipped someone whose away
--    covered the day and who had switched a meal back on before the block: their plate stayed 0 and left the bill. Now the
--    0 stays only while they are still away by an away saved after the snapshot (the snapshot already holds 0 for meals an
--    earlier away switched off; a cancelled one no longer counts).
-- 2. The snapshot is this block's: one saved after the last Cook again over that day and meal. An older block's snapshot
--    could put back plates (guests) that were gone before this block began.
create or replace function set_cook_again(f uuid, d_from date, d_to date, meals text, log_val jsonb, actor uuid, first_open date) returns void language plpgsql as $$
begin
  perform 1 from flats where id = f for no key update;
  with unblocked as (delete from no_cook where flat_id = $1 and date between $2::date and $3::date
     and meal = any(string_to_array($4::text, ',')) returning date, meal),
   snap as (select distinct on (e->>'m', e->>'d', e->>'x') (e->>'m')::uuid as m, (e->>'d')::date as d, e->>'x' as x, (e->>'c')::int as c,
       coalesce((e->>'g')::int, greatest((e->>'c')::int - 1, 0)) as g,   -- snapshots from before 004 had no guests
       a.id as sid
     from audit_log a, jsonb_array_elements(a.before) e
     where a.flat_id = $1 and a.entity_id = 'flat|nocook' and jsonb_typeof(a.before) = 'array'
       and a.id > coalesce((select max(c.id) from audit_log c where c.flat_id = $1 and c.entity_id = 'flat|nocook' and c.after ? 'cookAgain'
         and (e->>'d')::date between (c.after->'cookAgain'->>0)::date and (c.after->'cookAgain'->>1)::date
         and e->>'x' = any(string_to_array(c.after->>'meals', ','))), 0)
     order by e->>'m', e->>'d', e->>'x', a.id desc),
   back as (update meal_changes mc set count = s.c, guests = s.g, updated_at = now() from unblocked u, snap s
     where mc.flat_id = $1 and mc.date = u.date and mc.meal = u.meal and mc.date >= $7::date and mc.count = 0
       and s.m = mc.member_id and s.d = mc.date and s.x = mc.meal
       and not (is_away($1, mc.member_id, mc.date)
         and exists (select 1 from audit_log w where w.flat_id = $1 and w.entity_id = mc.member_id::text || '|away' and w.id > s.sid
           and w.after ? 'away' and mc.date between (w.after->'away'->>0)::date and (w.after->'away'->>1)::date))),
   plain as (delete from meal_changes mc using unblocked u
     where mc.flat_id = $1 and mc.date = u.date and mc.meal = u.meal and mc.date >= $7::date and mc.count = 0
       and not exists (select 1 from snap s where s.m = mc.member_id and s.d = mc.date and s.x = mc.meal)
       and not is_away($1, mc.member_id, mc.date))
  insert into audit_log (flat_id, entity, entity_id, after, by_member) values ($1, 'meal_changes', 'flat|nocook', $5, $6);
end $$;
