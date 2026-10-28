-- The bazar list (020). Each bazar and bill can carry a receipt photo and is checked: Verified or Needs correction.
-- The check lives in its own table, never on ledger: the ledger trigger (009/011) bumps months.version and
-- flats.offer_version on every ledger write, so a check tap there would cancel a waiting handover and stop a close card
-- though no money moved. No row = waiting for a check.
create table entry_checks (
  flat_id   uuid not null references flats on delete cascade,
  ledger_id uuid primary key,   -- no foreign key to ledger: a removed entry that is put back keeps its check
  month     date not null,      -- the entry's month: the purge finds the check of a removed entry by it
  state     text not null check (state in ('ok', 'fix')),
  note      text check (length(note) between 1 and 100),   -- Needs correction's reason
  by_member uuid,                -- null: marked Verified by this migration for the entries from before
  at        timestamptz not null default now(),
  check ((state = 'fix') = (note is not null)),
  foreign key (flat_id, by_member) references members (flat_id, id)
);

-- What a bazar bought: optional lines, a name and an optional amount. What they leave of the total shows as Other items.
create table bazar_items (
  flat_id       uuid not null,
  ledger_id     uuid not null,
  pos           smallint not null check (pos between 0 and 29),
  name          text not null check (length(name) between 1 and 40),
  amount_poisha bigint check (amount_poisha > 0),
  primary key (ledger_id, pos),
  foreign key (flat_id, ledger_id) references ledger (flat_id, id) on delete cascade
);

-- A bazar's or bill's receipt photo, a small JPEG made on the phone. No foreign key to ledger: a removed entry that is put
-- back keeps its receipt. The cron deletes it 90 days after its month closed, or once a removed entry's month closed.
create table receipts (
  flat_id    uuid not null references flats on delete cascade,
  ledger_id  uuid primary key,
  month      date not null,
  photo      bytea not null check (length(photo) <= 250000),
  created_at timestamptz not null default now()
);

-- Who may check entry e on day `today`: nobody checks their own spending. The collector checks, unless they added it, paid
-- it (flat money counts: they hold it) or fixed it last; then any other member living here who did none of these; if
-- there is nobody like that, the collector after all. Only people living here `today`. Null for an unknown entry.
create function may_check(e uuid, p uuid, today date) returns boolean language sql stable as $$
  select case
    when not exists (select 1 from members h where h.flat_id = l.flat_id and h.id = p and h.joined_on <= today
                       and (h.left_on is null or h.left_on >= today)) then false
    when not (c.id = any (i.ids)) then p = c.id
    when p <> c.id then not (p = any (i.ids))
    else not exists (select 1 from members h where h.flat_id = l.flat_id and h.id <> c.id and not (h.id = any (i.ids))
                       and h.joined_on <= today and (h.left_on is null or h.left_on >= today))
  end
  from ledger l
  join members c on c.flat_id = l.flat_id and c.role = 'manager'
  cross join lateral (select array_remove(array[l.created_by, coalesce(l.paid_by_member_id, c.id),
    (select a.by_member from audit_log a where a.flat_id = l.flat_id and a.entity = 'ledger' and a.entity_id = l.id::text
       and a.after ? 'fixed' order by a.id desc limit 1)], null) as ids) i
  where l.id = e
$$;

-- Every bazar and bill from before counts as Verified: nobody is asked to check old months. (lib/bazar.test.ts runs this block.)
-- backfill start
insert into entry_checks (flat_id, ledger_id, month, state)
  select flat_id, id, month, 'ok' from ledger where type in ('bazar', 'bill') on conflict do nothing;
-- backfill end
