-- the cook's mobile number (01XXXXXXXXX) and whether they use WhatsApp; the Plates to cook card calls or messages them
alter table flats add column cook_phone text check (cook_phone ~ '^01[3-9][0-9]{8}$');
alter table flats add column cook_whatsapp boolean not null default false;
-- tomorrow's count as first seen after the lock time; later views compare against it to say what changed
alter table flats add column lock_date date;
alter table flats add column lock_count jsonb;
