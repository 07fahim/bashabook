-- The settings triggers (009) bumped every open month with one update, which locks the month rows in heap order; writers
-- that touch several months row by row (away days across a month end, no cooking over a range, bring back) lock them in date
-- order. Two such writes at once could deadlock (measured on Neon: 4 in 40 rounds). Both triggers now lock the open months
-- in month order first, so they take them in the same order as those writers (0 in 160 rounds after).
-- Those row-by-row writers follow date order because their queries emit rows in that order today, not because anything
-- forces it; a plan change could break it. Not observed; lib/db.ts retries a deadlock once if it ever happens.
create or replace function touch_open_months() returns trigger language plpgsql as $$
declare f uuid;
begin
  if tg_op = 'DELETE' then f := old.flat_id; else f := new.flat_id; end if;
  perform 1 from months where flat_id = f and status = 'open' order by month for no key update;
  update months set version = version + 1 where flat_id = f and status = 'open';
  return null;
end $$;

create or replace function touch_flat_months() returns trigger language plpgsql as $$
begin
  perform 1 from months where flat_id = new.id and status = 'open' order by month for no key update;
  update months set version = version + 1 where flat_id = new.id and status = 'open';
  return null;
end $$;
