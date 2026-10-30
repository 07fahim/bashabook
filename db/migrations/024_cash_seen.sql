-- Cash seen (trust feature 1): after a close, people who lived that month say they saw the cash the collector counted.
-- One row per person and month; the closed month itself is never touched.
create table cash_seen (
  flat_id uuid not null references flats on delete cascade,
  month date not null,
  member_id uuid not null,
  at timestamptz not null default now(),
  primary key (flat_id, month, member_id),
  foreign key (flat_id, member_id) references members (flat_id, id) on delete cascade
);
create trigger live_ping after insert or update or delete on cash_seen for each row execute function live_ping();
