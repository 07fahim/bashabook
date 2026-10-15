-- The bell: when this person last opened their notices. Defaults to now, so nobody starts with a pile of old items.
alter table members add column notices_seen_at timestamptz not null default now();
