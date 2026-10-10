-- Plan 6a: month close. A month's version moves with every write that changes its result; a closed month refuses them.
alter table months add column version int not null default 0, add column cash jsonb;
alter table month_balances add column adjustments bigint not null default 0;
alter table ledger add column for_month date, add column moves uuid;
alter table ledger drop constraint ledger_type_check;
alter table ledger add constraint ledger_type_check check (type in ('deposit','bazar','bill','payout','adjustment'));
-- an adjustment moves money between two people of a closed month: both people and the month are required
alter table ledger add constraint ledger_adjustment_check check ((type = 'adjustment') = (moves is not null) and (type <> 'adjustment' or for_month is not null));

-- Bumps the month holding day d. Refuses if that month is closed. A month with no row can't be closed, so nothing to do.
-- Runs inside the writing statement (trigger), so the row lock it takes serialises the write with closeMonth.
create function month_touch(f uuid, d date) returns void language plpgsql as $$
begin
  update months set version = version + 1 where flat_id = f and month = date_trunc('month', d)::date and status = 'open';
  if not found and exists (select 1 from months where flat_id = f and month = date_trunc('month', d)::date and status = 'closed') then
    raise exception 'month_closed' using errcode = 'P0001';
  end if;
end $$;

create function touch_ledger() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then perform month_touch(old.flat_id, old.month); end if;
  if tg_op <> 'DELETE' then perform month_touch(new.flat_id, new.month); end if;
  return null;
end $$;
create trigger ledger_month after insert or update or delete on ledger for each row execute function touch_ledger();

create function touch_dated() returns trigger language plpgsql as $$
begin
  if tg_op <> 'INSERT' then perform month_touch(old.flat_id, old.date); end if;
  if tg_op <> 'DELETE' then perform month_touch(new.flat_id, new.date); end if;
  return null;
end $$;
create trigger meal_changes_month after insert or update or delete on meal_changes for each row execute function touch_dated();
create trigger no_cook_month after insert or update or delete on no_cook for each row execute function touch_dated();

-- settings that apply to every open month: weights, usual meals, rooms, rent shares, room assignments, joins and leaves.
-- Two functions: plpgsql resolves every field it names, and flats has id where the others have flat_id.
create function touch_open_months() returns trigger language plpgsql as $$
declare f uuid;
begin
  if tg_op = 'DELETE' then f := old.flat_id; else f := new.flat_id; end if;
  update months set version = version + 1 where flat_id = f and status = 'open';
  return null;
end $$;
create function touch_flat_months() returns trigger language plpgsql as $$
begin
  update months set version = version + 1 where flat_id = new.id and status = 'open';
  return null;
end $$;
create trigger flats_months after update of weight_b, weight_l, weight_d on flats for each row execute function touch_flat_months();
create trigger members_months after insert or update of joined_on, left_on, room_id, default_b, default_l, default_d, in_meals on members
  for each row execute function touch_open_months();
create trigger rooms_months after insert or update or delete on rooms for each row execute function touch_open_months();
