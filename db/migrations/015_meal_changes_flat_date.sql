-- loadMeals reads one flat's rows by date (where flat_id = $1 and date between ...) on every page; the primary key starts with
-- member_id, so without this every flat's page scanned every flat's meal rows. Additive, no data change.
create index meal_changes_flat_date on meal_changes (flat_id, date);
