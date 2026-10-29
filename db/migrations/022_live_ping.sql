-- Instant page updates (spec 2026-10-29). Every open page of a flat listens on the flat's secret topic (Supabase Realtime
-- broadcast, public channel: the topic is the secret, shown only to signed-in members). Any write to something a page shows
-- sends one empty 'changed' signal per flat per transaction; the page then reloads its data. Nothing readable is sent, and a
-- failed send never fails the write: pages also refresh when they come back on screen.
alter table flats add column live_topic text not null default replace(gen_random_uuid()::text, '-', '');

create function live_ping() returns trigger language plpgsql as $$
declare
  n jsonb;   -- each row is turned into json once: members and receipts carry photo bytes
  o jsonb;
  r jsonb;
  f text;
  t text;
begin
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  -- nothing a page shows changed: the Notices page marks itself seen on every visit, a signal there would refresh it forever
  if tg_op = 'UPDATE' and n - 'notices_seen_at' = o - 'notices_seen_at' then return null; end if;
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

create trigger live_ping after insert or update or delete on flats for each row execute function live_ping();
create trigger live_ping after insert or update or delete on members for each row execute function live_ping();
create trigger live_ping after insert or update or delete on rooms for each row execute function live_ping();
create trigger live_ping after insert or update or delete on months for each row execute function live_ping();
create trigger live_ping after insert or update or delete on ledger for each row execute function live_ping();
create trigger live_ping after insert or update or delete on bill_split_members for each row execute function live_ping();
create trigger live_ping after insert or update or delete on bill_templates for each row execute function live_ping();
create trigger live_ping after insert or update or delete on month_balances for each row execute function live_ping();
create trigger live_ping after insert or update or delete on meal_changes for each row execute function live_ping();
create trigger live_ping after insert or update or delete on no_cook for each row execute function live_ping();
create trigger live_ping after insert or update or delete on handovers for each row execute function live_ping();
create trigger live_ping after insert or update or delete on entry_checks for each row execute function live_ping();
create trigger live_ping after insert or update or delete on bazar_items for each row execute function live_ping();
create trigger live_ping after insert or update or delete on receipts for each row execute function live_ping();
