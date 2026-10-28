# Data retention and deletion (pilot)

What BashaBook keeps, for how long, and how it is deleted. Decided 2026-10-11 for the pilot; revisit before a public launch.

## What is kept

- A flat's records (people, meals, money, history) are kept for as long as the flat uses the app. A month that has closed is
  never changed; a person who moves out keeps their rows, because the flat's history and settlement need them. The privacy page
  says this: a mover's records stay for the flat's history.
- Personal data held per person: name, optional mobile number, optional small photo, PIN hash, sign-in sessions (90 days each).
  A person can remove their own photo and phone number in the app at any time; their name stays in the flat's records.
- A flat's records are copied only into the nightly backup (below). Production moved from Neon to Supabase (free plan) on 2026-10-28;
  the free plan has no backups and no point-in-time restore (supabase.com/docs/guides/platform/backups, read 2026-10-28). The collector can
  download a closed month as CSV. Since 2026-10-27 the live site sends page visits to Google Analytics 4 (only when
  `NEXT_PUBLIC_GA_ID` is set, on Production): the page address with a join code hidden and no query string, plus what
  Google's tag itself collects (cookies, device, rough location). No names, phones, amounts or form contents.

## Deleting a flat

A flat is deleted whole, on the collector's request, by the app team with `scripts/delete-flat.mts` (dry run first, then
`--apply`). One statement removes the flat and every row that belongs to it: people, rooms, months, entries, meals, history,
handovers, sessions. Nothing of any other flat is touched (`lib/delete-flat.test.ts`). Since 2026-10-28 a nightly full copy of production (private repo
07fahim/bashabook-backups, GitHub Actions at 03:30 Dhaka, restored into an empty Postgres 17 before it is kept; IP rate-limit
rows and sessions left out) is kept 7 days, so a deleted flat is gone for good 7 days after deletion, and a wrong deletion
or a bad migration can be undone from the last night's copy (entries since that copy are lost). Supabase free itself keeps
no backup or history. Run every `--apply` and every migration only after the dry run and the test copy (check the test copy
is at the same migration as production first). (On Neon until 2026-10-28 the window was
6 hours of point-in-time history, restore-tested 2026-10-11.)

Trials nobody came back to are deleted on their own (since 2026-10-24, `runJobs` in `lib/jobs.ts`): a flat created more
than 30 days ago where at most one person claimed a PIN, no money entry and no meal change ever existed, and nothing was
written to the history for 30 days. Any flat with two claimed people, one money entry or one meal change is never touched by this. The cron run logs the names it
removed (`purged` in the response, saved in cron-job.org's history).

Also since 2026-10-24: anonymous actions are counted per connection and hour (`rate_limits`, `lib/rate-limit.ts`): 5 new
flats, 120 code lookups, 60 PIN posts; past that the page says to wait an hour. The counts hold the visitor's IP: each cron run deletes
counts older than 2 hours (the privacy page promises about 2 hours); if the cron stops, they stay until the next anonymous visit. A flat holds 30 names in all (`MAX_MEMBERS`).

Before deleting: confirm the request with the collector on a verified number (as in `ops/collector-pin-recovery.md`) and,
because the records belong to the whole flat, with one other flatmate. Tell them the data cannot be recovered afterwards. The flat's own history goes with it, so write the date, flat name, who asked and
who confirmed in the app-team log (the script prints the line to paste).

## Not offered in the pilot

- Deleting one person from a flat's history (their meals and money are part of everyone's bill).
- Deleting one closed month.
- Self-service deletion in the app.

If pilot flats ask for any of these, that is a product decision, not an ops one.
