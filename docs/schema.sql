-- Mil V1 database schema (Postgres 15+)
-- Money is integer poisha (1 taka = 100 poisha). Meal weights are integer hundredths (50 = 0.5).
-- Dates are Asia/Dhaka calendar dates. Every child row carries flat_id and uses composite
-- foreign keys, so a row can never point at another flat's member, room or ledger entry.

create table flats (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  join_code       text not null unique,
  weight_b        smallint not null default 50  check (weight_b between 0 and 1000),
  weight_l        smallint not null default 100 check (weight_l between 0 and 1000),
  weight_d        smallint not null default 100 check (weight_d between 0 and 1000),
  cutoff_time     time not null default '22:00',
  strictness      text not null default 'relaxed' check (strictness in ('relaxed','strict')),
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
  rent_share_poisha bigint not null default 0 check (rent_share_poisha >= 0),
  unique (flat_id, id)
);

create table members (
  id               uuid primary key default gen_random_uuid(),
  flat_id          uuid not null references flats on delete cascade,
  name             text not null,
  pin_hash         text,                                -- null = name not claimed yet
  must_change_pin  boolean not null default false,      -- true after a manager reset
  role             text not null default 'member' check (role in ('member','manager')),
  room_id          uuid,
  joined_on        date not null,
  left_on          date,
  default_b        boolean not null default true,
  default_l        boolean not null default true,
  default_d        boolean not null default true,
  language         text check (language in ('bn','en')),  -- null = flat default
  failed_pin_count int not null default 0,
  locked_until     timestamptz,
  unique (flat_id, name),
  unique (flat_id, id),
  foreign key (flat_id, room_id) references rooms (flat_id, id),
  check (left_on is null or left_on >= joined_on)
);
-- at most one manager per flat; handover demotes then promotes in one transaction
create unique index one_manager_per_flat on members (flat_id) where role = 'manager';

create table meal_changes (
  flat_id    uuid not null,
  member_id  uuid not null,
  date       date not null,
  meal       char(1) not null check (meal in ('b','l','d')),
  count      int not null check (count between 0 and 10),   -- 0 off, 1 on, 2+ with guests
  late       boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (member_id, date, meal),
  foreign key (flat_id, member_id) references members (flat_id, id) on delete cascade
);

create table duties (
  flat_id   uuid not null references flats on delete cascade,
  date      date not null,
  member_id uuid not null,
  primary key (flat_id, date),
  foreign key (flat_id, member_id) references members (flat_id, id) on delete cascade
);

create table months (
  flat_id      uuid not null references flats on delete cascade,
  month        date not null check (extract(day from month) = 1),   -- first day of month
  status       text not null default 'open' check (status in ('open','closed')),
  closing_fund bigint,          -- set at close
  cash_counted bigint,          -- cash + bKash the manager says they hold at close
  meal_rate    bigint,          -- poisha per weighted meal, set at close
  closed_at    timestamptz,
  primary key (flat_id, month)
);

create table ledger (
  id                uuid primary key default gen_random_uuid(),
  flat_id           uuid not null references flats on delete cascade,
  month             date not null,
  type              text not null check (type in ('deposit','bazar','bill','payout')),
  amount_poisha     bigint not null check (amount_poisha > 0),
  paid_by_member_id uuid,   -- bazar/bill: who paid; null = paid from fund
  member_id         uuid,   -- deposit: who paid in; payout: who received
  split             text check (split in ('equal','meals','room','selected')),
  date              date not null,
  note              text,
  trxid             text,
  status            text not null default 'ok' check (status in ('ok','pending')),
  version           int not null default 1,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  unique (flat_id, id),
  unique (flat_id, trxid),
  foreign key (flat_id, month) references months,
  foreign key (flat_id, paid_by_member_id) references members (flat_id, id),
  foreign key (flat_id, member_id) references members (flat_id, id),
  foreign key (flat_id, created_by) references members (flat_id, id),
  check (date_trunc('month', date)::date = month),
  check ((type = 'bill') = (split is not null)),
  check (case when type in ('deposit','payout') then member_id is not null and paid_by_member_id is null
              else member_id is null end)
);
create index ledger_flat_month on ledger (flat_id, month);

create table bill_split_members (
  flat_id   uuid not null,
  ledger_id uuid not null,
  member_id uuid not null,
  primary key (ledger_id, member_id),
  foreign key (flat_id, ledger_id) references ledger (flat_id, id) on delete cascade,
  foreign key (flat_id, member_id) references members (flat_id, id) on delete cascade
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

-- frozen result of each member at month close; the next month opens from these balances
create table month_balances (
  flat_id        uuid not null,
  month          date not null,
  member_id      uuid not null,
  weighted_meals int not null,
  days_present   int not null,
  opening        bigint not null,
  paid_in        bigint not null,
  food_cost      bigint not null,
  bill_share     bigint not null,
  payouts        bigint not null,
  balance        bigint not null,
  primary key (flat_id, month, member_id),
  foreign key (flat_id, month) references months,
  foreign key (flat_id, member_id) references members (flat_id, id)
);

-- edits to existing rows that need manager approval (closed months, strict mode)
create table change_requests (
  id           uuid primary key default gen_random_uuid(),
  flat_id      uuid not null references flats on delete cascade,
  entity       text not null check (entity in ('ledger','meal_changes')),
  entity_id    text,                       -- null = new row
  payload      jsonb not null,
  requested_by uuid not null,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by   uuid,
  created_at   timestamptz not null default now(),
  foreign key (flat_id, requested_by) references members (flat_id, id),
  foreign key (flat_id, decided_by) references members (flat_id, id)
);

create table audit_log (
  id        bigserial primary key,
  flat_id   uuid not null references flats on delete cascade,
  entity    text not null,
  entity_id text not null,
  before    jsonb,
  after     jsonb,
  by_member uuid,
  at        timestamptz not null default now(),
  foreign key (flat_id, by_member) references members (flat_id, id)
);

create table push_subs (
  id        uuid primary key default gen_random_uuid(),
  flat_id   uuid not null references flats on delete cascade,
  member_id uuid,                     -- null = cook link subscriber
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  foreign key (flat_id, member_id) references members (flat_id, id) on delete cascade
);

create table sent_jobs (
  flat_id  uuid not null references flats on delete cascade,
  date     date not null,
  job_type text not null,
  sent_at  timestamptz not null default now(),
  primary key (flat_id, date, job_type)
);

-- deleted on PIN reset and move-out
create table sessions (
  token_hash text primary key,
  member_id  uuid not null references members on delete cascade,
  expires_at timestamptz not null
);
