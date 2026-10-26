-- How money in or out was paid: cash, bKash, Nagad or bank. Optional (null: not said, and every row from before). Only
-- deposits and payouts carry one: a bazar or a bill is money spent, not money moved between people and the fund.
alter table ledger add column method text check (method in ('cash', 'bkash', 'nagad', 'bank'));
alter table ledger add constraint method_only_moving check (method is null or type in ('deposit', 'payout'));
