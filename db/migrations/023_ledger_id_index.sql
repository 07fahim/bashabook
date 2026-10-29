-- retiredId (lib/money-db.ts) asks on every new entry whether any flat's ledger ever had this id: by id, across flats.
create index audit_log_ledger_id on audit_log (entity_id) where entity = 'ledger';
