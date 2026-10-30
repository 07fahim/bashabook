-- A monthly bill copied into a new month waits as 'due' until the collector taps Paid: copied as already paid on the 1st, it
-- took the rent out of flat money days before the landlord was paid, so the collector's money and the month-end count were
-- wrong (a close on the 1st asked to count ৳0). A due bill counts nowhere (every sum reads 'ok' rows only).
alter table ledger drop constraint ledger_status_check;
alter table ledger add constraint ledger_status_check check (status in ('ok', 'pending', 'due'));
