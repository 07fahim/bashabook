# Data retention and deletion (pilot)

What BashaBook keeps, for how long, and how it is deleted. Decided 2026-10-11 for the pilot; revisit before a public launch.

## What is kept

- A flat's records (people, meals, money, history) are kept for as long as the flat uses the app. A month that has closed is
  never changed; a person who moves out keeps their rows, because the flat's history and settlement need them. The landing page
  says this: a mover's records stay for the flat's history.
- Personal data held per person: name, optional mobile number, optional small photo, PIN hash, sign-in sessions (90 days each).
  A person can remove their own photo and phone number in the app at any time; their name stays in the flat's records.
- Nothing is copied anywhere else: no analytics, no export, no backup outside Neon's own point-in-time history.

## Deleting a flat

A flat is deleted whole, on the collector's request, by the app team with `scripts/delete-flat.mts` (dry run first, then
`--apply`). One statement removes the flat and every row that belongs to it: people, rooms, months, entries, meals, history,
handovers, sessions. Nothing of any other flat is touched (`lib/delete-flat.test.ts`). The deletion also leaves Neon's
point-in-time history after its retention window, so a request is final after that window. The window is **6 hours** on this project (Neon free plan,
history retention; checked 2026-10-11). The same 6 hours is all the undo there is for any mistake: a wrong deletion or a bad
migration must be noticed the same day. Restore tested 2026-10-11: a branch of production forked at a time 29 minutes before
migration 015 showed 014 as its last migration, with every flat and entry present, read through the app's own client.

Trials nobody came back to are deleted on their own (since 2026-10-24, `runJobs` in `lib/jobs.ts`): a flat created more
than 30 days ago where at most one person claimed a PIN, no money entry and no meal change ever existed, and nothing was
written to the history for 30 days. Any flat with two claimed people, one money entry or one meal change is never touched by this. The cron run logs the names it
removed (`purged` in the response, saved in cron-job.org's history).

Also since 2026-10-24: anonymous actions are counted per connection and hour (`rate_limits`, `lib/rate-limit.ts`): 5 new
flats, 120 code lookups, 60 PIN posts; past that the page says to wait an hour. A flat holds 30 names in all (`MAX_MEMBERS`).

Before deleting: confirm the request with the collector on a verified number (as in `ops/collector-pin-recovery.md`) and,
because the records belong to the whole flat, with one other flatmate. Tell them the data cannot be recovered afterwards. The flat's own history goes with it, so write the date, flat name, who asked and
who confirmed in the app-team log (the script prints the line to paste).

## Not offered in the pilot

- Deleting one person from a flat's history (their meals and money are part of everyone's bill).
- Deleting one closed month.
- Self-service deletion in the app.

If pilot flats ask for any of these, that is a product decision, not an ops one.
