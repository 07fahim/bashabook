-- Plan 6a fix round 1: a Kind B adjustment (money moved from member_id to moves) needs member_id set,
-- same as deposit/payout. 001's ledger_check2 forced member_id null for every type but deposit/payout,
-- which blocked adjustment inserts outright (before ledger_adjustment_check even ran). Widen it.
alter table ledger drop constraint ledger_check2;
alter table ledger add constraint ledger_check2
  check (case when type in ('deposit','payout','adjustment') then member_id is not null and paid_by_member_id is null
              else member_id is null end);
-- note: an update that keeps a row in the same month still bumps that month's version twice (old + new row);
-- versions are only ever compared for equality, so the double bump is harmless.
