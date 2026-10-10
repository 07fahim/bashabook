-- A name can come back once its person has moved out: two people may share a name only if their stays don't overlap
-- (the join page shows names, so two people living here at once still need names that tell them apart).
create extension if not exists btree_gist;
alter table members drop constraint members_flat_id_name_key;
alter table members add constraint one_name_per_stay
  exclude using gist (flat_id with =, name with =, daterange(joined_on, left_on, '[]') with &&);
