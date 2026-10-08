-- Mil V1 database schema (Postgres 15+)
-- Money is always integer poisha (1 taka = 100 poisha). Dates are Asia/Dhaka calendar dates.

create table flats (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  join_code       text not null unique,
  weight_b        numeric(3,2) not null default 0.5 check (weight_b >= 0),
  weight_l        numeric(3,2) not null default 1   check (weight_l >= 0),
  weight_d        numeric(3,2) not null default 1   check (weight_d >= 0),
  cutoff_time     time not null default '22:00',
  strictness      text not null default 'relaxed' check (strictness in ('relaxed','strict')),
  fund_enabled    boolean not null default true,
  bkash_number    text,
  language        text not null default 'bn' check (language in ('bn','en')),
  rotation_order  uuid[] not null default '{}',        -- member ids, bazar duty order
  cook_link_token text unique,                         -- null = cook link off
  created_at      timestamptz not null default now()
);

create table rooms (
  id                uuid primary key default gen_random_uuid(),
  flat_id           uuid not null references flats on delete cascade,
  name              text not null,
  rent_share_poisha bigint not null default 0 check (rent_share_poisha >= 0)
);

create table members (
  id               uuid primary key default gen_random_uuid(),
  flat_id          uuid not null references flats on delete cascade,
  name             text not null,
  pin_hash         text,                                -- null = name not claimed yet
  role             text not null default 'member' check (role in ('member','manager')),
  room_id          uuid references rooms on delete set null,
  joined_on        date not null,
  left_on          date,
  default_b        boolean not null default true,
  default_l        boolean not null default true,
  default_d        boolean not null default true,
  language         text check (language in ('bn','en')),  -- null = flat default
  failed_pin_count int not null default 0,
  locked_until     timestamptz,
  unique (flat_id, name),
  check (left_on is null or left_on >= joined_on)
);
-- exactly one manager per flat
create unique index one_manager_per_flat on members (flat_id) where role = 'manager';

create table meal_changes (
  member_id  uuid not null references members on delete cascade,
  date       date not null,
  meal       char(1) not null check (meal in ('b','l','d')),
  count      int not null check (count between 0 and 10),   -- 0 off, 1 on, 2+ with guests
  late       boolean not null default false,
  status     text not null default 'ok' check (status in ('ok','pending')),
  updated_at timestamptz not null default now(),
  primary key (member_id, date, meal)
);

create table duties (
  flat_id   uuid not null references flats on delete cascade,
  date      date not null,
  member_id uuid not null references members on delete cascade,
  primary key (flat_id, date)
);

create table months (
  flat_id   uuid not null references flats on delete cascade,
  month     date not null check (extract(day from month) = 1),   -- first day of month
  status    text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  primary key (flat_id, month)
);

create table ledger (
  id                uuid primary key default gen_random_uuid(),
  flat_id           uuid not null references flats on delete cascade,
  month             date not null,
  type              text not null check (type in ('deposit','bazar','bill','payout')),
  amount_poisha     bigint not null check (amount_poisha > 0),
  paid_by_member_id uuid references members,   -- bazar/bill: null = paid from fund
  member_id         uuid references members,   -- deposit: who paid in; payout: who received
  split             text check (split in ('equal','meals','room','selected')),
  date              date not null,
  note              text,
  trxid             text,
  status            text not null default 'ok' check (status in ('ok','pending')),
  version           int not null default 1,
  created_by        uuid not null references members,
  created_at        timestamptz not null default now(),
  foreign key (flat_id, month) references months,
  unique (flat_id, trxid),
  check ((type = 'bill') = (split is not null)),
  check (type not in ('deposit','payout') or member_id is not null)
);
create index ledger_flat_month on ledger (flat_id, month);

create table bill_split_members (
  ledger_id uuid not null references ledger on delete cascade,
  member_id uuid not null references members on delete cascade,
  primary key (ledger_id, member_id)
);

create table bill_templates (
  id                  uuid primary key default gen_random_uuid(),
  flat_id             uuid not null references flats on delete cascade,
  name                text not null,
  amount_poisha       bigint not null check (amount_poisha > 0),
  split               text not null check (split in ('equal','meals','room','selected')),
  selected_member_ids uuid[] not null default '{}',
  paid_from_fund      boolean not null default true
);

create table change_requests (
  id           uuid primary key default gen_random_uuid(),
  flat_id      uuid not null references flats on delete cascade,
  entity       text not null,              -- 'ledger' | 'meal_changes'
  entity_id    text,                       -- null = new row
  payload      jsonb not null,
  requested_by uuid not null references members,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by   uuid references members,
  created_at   timestamptz not null default now()
);

create table audit_log (
  id        bigserial primary key,
  flat_id   uuid not null references flats on delete cascade,
  entity    text not null,
  entity_id text not null,
  before    jsonb,
  after     jsonb,
  by_member uuid references members,
  at        timestamptz not null default now()
);

create table push_subs (
  id        uuid primary key default gen_random_uuid(),
  flat_id   uuid not null references flats on delete cascade,
  member_id uuid references members on delete cascade,   -- null = cook link subscriber
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null
);

create table sent_jobs (
  flat_id  uuid not null references flats on delete cascade,
  date     date not null,
  job_type text not null,
  sent_at  timestamptz not null default now(),
  primary key (flat_id, date, job_type)
);

create table sessions (
  token_hash text primary key,
  member_id  uuid not null references members on delete cascade,
  expires_at timestamptz not null
);
