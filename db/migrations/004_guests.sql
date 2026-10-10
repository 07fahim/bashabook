-- Guest plates are kept apart from the person's own plate. `count` stays the total plates and is still
-- the only number billing reads; the person's own plate is count - guests and can only be 0 or 1.
alter table meal_changes add column guests int not null default 0;

-- Before this, a row with more than one plate was the person plus guests: keep every total as it is.
update meal_changes set guests = count - 1 where count > 1;

alter table meal_changes add constraint meal_changes_guests check (guests >= 0 and count - guests between 0 and 1);
