-- Each person's email, mandatory for new sign-ups (the app asks; the column stays nullable for people who joined before):
-- a forgotten flat code or PIN is recovered with a 6-digit code sent here. Never shown to flatmates.
alter table members
  add column email text check (email = lower(email) and length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  add column email_ok boolean not null default false,   -- confirmed by the link, or by a recovery code typed from the inbox
  add column email_token text;                          -- sha256 of the waiting confirmation link's token
create index members_email on members (email) where email is not null;
create index members_email_token on members (email_token) where email_token is not null;

-- One row per "Send me a code", for any email (so the screen never tells whether it is known). The browser keeps the
-- token in the httpOnly cookie `recover`; only its sha256 is here. The cron sweeps rows after a day.
create table recoveries (
  token_hash text primary key,
  email      text not null,
  code_hash  text not null,
  tries      int not null default 0,
  proven     boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index recoveries_email on recoveries (email, created_at);
