-- Plan 6b: handing the collector role (and the flat's cash) to a flatmate.
-- offer_version: anything that makes a waiting handover offer invalid moves it (every ledger write, move-out changes,
-- offers, accepts, overrides). A handover changes who holds the cash, never the fund or a balance: no ledger entry.
alter table flats add column offer_version int not null default 0;

-- the ledger trigger from 009 also bumps the flat's offer_version (a pending entry is a ledger row too)
create or replace function touch_ledger() returns trigger language plpgsql as $$
begin
  -- flats first, then months: one lock order everywhere, so it can't deadlock with set_leaving or a settings save
  update flats set offer_version = offer_version + 1 where id = case when tg_op = 'DELETE' then old.flat_id else new.flat_id end;
  if tg_op <> 'INSERT' then perform month_touch(old.flat_id, old.month); end if;
  if tg_op <> 'DELETE' then perform month_touch(new.flat_id, new.month); end if;
  return null;
end $$;

-- one collector per flat, checked at the end of the transaction so one statement can swap two people.
-- using btree: core Postgres, no btree_gist extension needed.
drop index one_manager_per_flat;
alter table members add constraint one_manager_per_flat
  exclude using btree (flat_id with =) where (role = 'manager') deferrable initially deferred;

-- who held the money for a deposit (received it) or a payout (handed it out): fixed when the entry is made, never
-- rewritten; labels use it, never the current collector
alter table ledger add column held_by uuid, add foreign key (flat_id, held_by) references members (flat_id, id);
-- backfill: before 011 nobody ever handed over, so the current collector held every one. The 009 trigger refuses any
-- change in a closed month, so it is off for this one update only. Removal records get their holder too, so a later
-- put back names who held the money, not whoever is collector then. (lib/handover.test.ts runs this block.)
-- backfill start
alter table ledger disable trigger ledger_month;
update ledger l set held_by = m.id from members m where m.flat_id = l.flat_id and m.role = 'manager' and l.type in ('deposit','payout');
alter table ledger enable trigger ledger_month;
update audit_log a set before = a.before || jsonb_build_object('held_by', m.id) from members m
  where a.entity = 'ledger' and a.after->>'removed' = 'true' and a.before->>'type' in ('deposit','payout')
    and not (a.before ? 'held_by') and m.flat_id = a.flat_id and m.role = 'manager';
-- backfill end
-- A payout or an ok deposit is only ever recorded by whoever holds the cash (payouts are collector-only; an ok deposit
-- is the collector's own record or Pay the gap), so it is held by its recorder: a payout the old collector recorded in
-- the window between the app's role check and the insert never names the new one. Only a pending deposit (a
-- flatmate's own) reads the current collector. Only when held_by is null: put back restores its own.
create function ledger_held_by() returns trigger language plpgsql as $$
begin
  if new.type = 'payout' or (new.type = 'deposit' and new.status = 'ok') then
    new.held_by := coalesce(new.held_by, new.created_by);
  elsif new.type = 'deposit' and new.held_by is null then
    select id into new.held_by from members where flat_id = new.flat_id and role = 'manager';
  end if;
  return new;
end $$;
create trigger ledger_held_by before insert on ledger for each row execute function ledger_held_by();

create table handovers (
  id             uuid primary key default gen_random_uuid(),
  flat_id        uuid not null references flats on delete cascade,
  from_member    uuid not null,
  to_member      uuid not null,
  amount         bigint,                         -- poisha; null for an override (no amount was confirmed)
  offer_version  int not null,
  status         text not null check (status in ('offered','accepted','declined','cancelled','overridden')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,                           -- null for an override and for a cancel because the money changed
  reason         text,                           -- override only
  admin          text,                           -- override only: who in the app team did it
  cash_confirmed boolean not null default false, -- true only after the recipient's accept
  foreign key (flat_id, from_member) references members (flat_id, id),
  foreign key (flat_id, to_member) references members (flat_id, id),
  foreign key (flat_id, decided_by) references members (flat_id, id)
);
create unique index one_offer_per_flat on handovers (flat_id) where status = 'offered';

-- living here now with no move-out date, and has signed in (claimed their name)
create function handover_eligible(f uuid, m uuid) returns boolean language sql stable as $$
  select exists (select 1 from members where flat_id = f and id = m and left_on is null and pin_hash is not null
                   and joined_on <= (now() at time zone 'Asia/Dhaka')::date)
$$;

-- The collector offers. Locks the flat row first; every read below is a fresh statement after the lock.
-- `seen` is the offer_version the app read before computing `total`; the offer stores the version after its own bump.
create function offer_handover(f uuid, by uuid, to_m uuid, seen int, total bigint) returns text language plpgsql as $$
declare v int;
begin
  select offer_version into v from flats where id = f for update;
  if v is distinct from seen then return 'changed'; end if;
  if not exists (select 1 from members where flat_id = f and id = by and role = 'manager') then return 'notCollector'; end if;
  if to_m = by or not handover_eligible(f, to_m) then return 'recipient'; end if;
  if total is null or total < 0 then return 'negative'; end if;
  if exists (select 1 from ledger where flat_id = f and status = 'pending') then return 'waiting'; end if;
  if exists (select 1 from handovers where flat_id = f and status = 'offered') then return 'already'; end if;
  update flats set offer_version = v + 1 where id = f;
  insert into handovers (flat_id, from_member, to_member, amount, offer_version, status) values (f, by, to_m, total, v + 1, 'offered');
  return 'ok';
end $$;

-- The named recipient accepts. All or nothing: a failed check returns without writing (except cancelling a stale offer);
-- the invariant check raises, which rolls back status, roles and counter together.
create function accept_handover(f uuid, h_id uuid, me uuid) returns text language plpgsql as $$
declare h handovers; v int;
begin
  select offer_version into v from flats where id = f for update;
  -- row lock: decline/cancel skip the flat lock, so a decline that started first makes this wait and read 'declined';
  -- one arriving later waits, then finds 'accepted'. Without it a decline could land between this read and the update.
  select * into h from handovers where id = h_id and flat_id = f for update;
  if not found then return 'gone'; end if;
  if h.status = 'accepted' and h.to_member = me then return 'ok'; end if;   -- second tap: same answer
  if h.status <> 'offered' then return h.status; end if;
  if h.to_member <> me then return 'notYou'; end if;
  if v <> h.offer_version
     or not exists (select 1 from members where flat_id = f and id = h.from_member and role = 'manager')
     or not handover_eligible(f, me) then
    update handovers set status = 'cancelled', decided_at = now() where id = h_id and status = 'offered';
    return 'changed';
  end if;
  update handovers set status = 'accepted', cash_confirmed = true, decided_by = me, decided_at = now() where id = h_id and status = 'offered';
  if not found then raise exception 'handover invariant broken'; end if;
  update members set role = case when id = me then 'manager' else 'member' end where flat_id = f and id in (h.from_member, me);
  update flats set offer_version = v + 1 where id = f;
  if (select count(*) from members where flat_id = f and role = 'manager') <> 1
     or not exists (select 1 from members where flat_id = f and id = me and role = 'manager') then
    raise exception 'handover invariant broken';
  end if;
  return 'ok';
end $$;

-- Move-out dates (replaces setLeaving's statement). Locks the flat row first, the same order as accept_handover, then
-- reads fresh: the caller must still be the collector and the person must not be the collector. The date and the
-- counter bump commit together. A name clash (taking a move-out back while a newcomer has the name) still raises.
create function set_leaving(f uuid, by uuid, m uuid, last_day date, today date) returns text language plpgsql as $$
begin
  perform 1 from flats where id = f for update;
  if not exists (select 1 from members where flat_id = f and id = by and role = 'manager')
     or m = by or exists (select 1 from members where flat_id = f and id = m and role = 'manager') then return 'no'; end if;
  if not exists (select 1 from members where flat_id = f and id = m and (left_on is null or left_on >= today)
                   and (last_day is null or last_day >= greatest(today, joined_on))) then return 'no'; end if;
  update members set left_on = last_day where flat_id = f and id = m and left_on is distinct from last_day;
  if found then   -- only a real change moves the counter: a stale re-send must not cancel a valid offer
    update flats set offer_version = offer_version + 1 where id = f;
    insert into audit_log (flat_id, entity, entity_id, after, by_member) values (f, 'members', m::text, jsonb_build_object('left', last_day), by);
  end if;
  return 'ok';
end $$;

-- App team only (scripts/override-collector.mts), when the collector can't hand over. Records the actual outgoing
-- collector read after the lock; never confirms cash; never touches waiting entries.
create function override_collector(f uuid, to_m uuid, why text, who text) returns text language plpgsql as $$
declare cur uuid;
begin
  perform 1 from flats where id = f for update;
  select id into cur from members where flat_id = f and role = 'manager';
  if cur is null then return 'noCollector'; end if;
  if to_m = cur or not handover_eligible(f, to_m) then return 'recipient'; end if;
  if coalesce(trim(why), '') = '' or coalesce(trim(who), '') = '' then return 'reason'; end if;
  update handovers set status = 'cancelled', decided_at = now() where flat_id = f and status = 'offered';
  insert into handovers (flat_id, from_member, to_member, amount, offer_version, status, decided_at, reason, admin, cash_confirmed)
    select f, cur, to_m, null, offer_version + 1, 'overridden', now(), trim(why), trim(who), false from flats where id = f;
  update members set role = case when id = to_m then 'manager' else 'member' end where flat_id = f and id in (cur, to_m);
  update flats set offer_version = offer_version + 1 where id = f;
  if (select count(*) from members where flat_id = f and role = 'manager') <> 1
     or not exists (select 1 from members where flat_id = f and id = to_m and role = 'manager') then
    raise exception 'handover invariant broken';
  end if;
  return 'ok';
end $$;
