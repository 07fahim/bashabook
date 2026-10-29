-- may_check as in 020, except that only claimed members (pin_hash set) count as other checkers: a name nobody claimed can't
-- sign in, so it must not leave the collector's own entries waiting and block the month close.
create or replace function may_check(e uuid, p uuid, today date) returns boolean language sql stable as $$
  select case
    when not exists (select 1 from members h where h.flat_id = l.flat_id and h.id = p and h.joined_on <= today
                       and (h.left_on is null or h.left_on >= today)) then false
    when not (c.id = any (i.ids)) then p = c.id
    when p <> c.id then not (p = any (i.ids))
    else not exists (select 1 from members h where h.flat_id = l.flat_id and h.id <> c.id and not (h.id = any (i.ids))
                       and h.pin_hash is not null and h.joined_on <= today and (h.left_on is null or h.left_on >= today))
  end
  from ledger l
  join members c on c.flat_id = l.flat_id and c.role = 'manager'
  cross join lateral (select array_remove(array[l.created_by, coalesce(l.paid_by_member_id, c.id),
    (select a.by_member from audit_log a where a.flat_id = l.flat_id and a.entity = 'ledger' and a.entity_id = l.id::text
       and a.after ? 'fixed' order by a.id desc limit 1)], null) as ids) i
  where l.id = e
$$;
