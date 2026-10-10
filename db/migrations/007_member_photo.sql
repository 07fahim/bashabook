-- an optional small profile photo (a JPEG the phone shrinks before upload); photo_v changes with every new photo so browsers can cache each one
alter table members add column photo bytea check (photo is null or octet_length(photo) <= 60000);
alter table members add column photo_v int not null default 0;
