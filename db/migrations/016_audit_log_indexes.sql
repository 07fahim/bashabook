-- Two reads of audit_log on every Home and Money load that grew with the flat's whole history (mostly meal taps):
-- the removed entries of a month (loadMonth) and the newest history rows (loadHistory, order by id desc).
-- The existing index (flat_id, entity_id) serves neither. Additive, no data change.
create index audit_log_removed on audit_log (flat_id, (before->>'month')) where entity = 'ledger' and after->>'removed' = 'true';
create index audit_log_flat_id on audit_log (flat_id, id desc);
