-- tomorrow's count as first seen after the lock time (lock_count, for the day lock_date);
-- later views compare the live count with it to say what changed after the lock
alter table flats add column lock_date date;
alter table flats add column lock_count jsonb;
