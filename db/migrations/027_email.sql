-- Each person's email, mandatory for new sign-ups (the app asks; the column stays nullable for people who joined before):
-- a forgotten flat code or PIN is recovered with an 8-digit code sent here. Never shown to flatmates.
-- The shape is the same pattern as normalizeEmail (lib/auth.ts): keep the two in step.
-- An email is saved only after a code typed from its inbox proved it (recoveries below).
alter table members
  add column email text check (email = lower(email) and length(email) <= 254 and email ~ '^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$');
create index members_email on members (email) where email is not null;

-- One row per emailed code: for getting back in ('recover', any email, so the screen never tells whether it is known)
-- or for proving an address before it is saved ('new' flat, 'claim' a name, 'email' added or changed). `payload` holds
-- what to do once proven, never a plain PIN. The browser keeps the token in an httpOnly cookie (`recover` or `check`);
-- only its sha256 is here. The cron sweeps rows after a day.
create table recoveries (
  token_hash text primary key,
  email      text not null,
  code_hash  text not null,
  tries      int not null default 0,
  proven     boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  purpose    text not null default 'recover' check (purpose in ('recover', 'new', 'claim', 'email')),
  payload    jsonb
);
create index recoveries_email on recoveries (email, created_at);

-- live_ping (022) unchanged except the skip line: email writes are private to the person and wake no page.
create or replace function live_ping() returns trigger language plpgsql as $$
declare
  n jsonb;   -- each row is turned into json once: members and receipts carry photo bytes
  o jsonb;
  r jsonb;
  f text;
  t text;
begin
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  -- nothing a page shows changed: the Notices page marks itself seen on every visit, a signal there would refresh it forever;
  -- an email is never shown to flatmates, so adding or changing one wakes no page (027)
  if tg_op = 'UPDATE' and n - array['notices_seen_at','email'] = o - array['notices_seen_at','email'] then return null; end if;
  -- a new join code gave a new topic: pages still on the old one reload once and pick up the new one
  if tg_op = 'UPDATE' and tg_table_name = 'flats' and o->>'live_topic' is distinct from n->>'live_topic' then
    begin
      perform realtime.send('{}'::jsonb, 'changed', o->>'live_topic', false);
    exception when others then null;
    end;
  end if;
  r := coalesce(n, o);
  f := case when tg_table_name = 'flats' then r->>'id' else r->>'flat_id' end;
  -- once per flat per transaction: a month close writes hundreds of rows and sends one signal
  if f is null or strpos(coalesce(current_setting('live.sent', true), ''), f) > 0 then return null; end if;
  perform set_config('live.sent', coalesce(current_setting('live.sent', true), '') || f || ',', true);
  begin
    select live_topic into t from flats where id = f::uuid;
    if t is not null then perform realtime.send('{}'::jsonb, 'changed', t, false); end if;
  exception when others then null;   -- no Realtime here (tests) or it failed: the write goes on
  end;
  return null;
end $$;
