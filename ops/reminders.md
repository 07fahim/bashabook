# Reminders (web push)

How BashaBook's reminders work and what to check when they don't.

- Each person turns reminders on per browser from Home → My account. The browser's subscription is saved in `push_subs`
  with the session's member; Turn off removes it. Deleting a flat or member removes theirs (cascade). A leaver stops
  getting reminders the day after `left_on`.
- Timed reminders run from `GET /api/cron` (`Authorization: Bearer CRON_SECRET`), called every 5 minutes by cron-job.org
  (job "BashaBook reminders", failure e-mails to the app team). Each flat: the meal reminder in the hour before its cutoff
  (everyone still living there, skipped when nothing is cooked tomorrow); the month-ready reminder to the collector once per
  month, from the 1st at 10:00. A reminder is claimed in `sent_jobs (flat, date or month, job)` before it is sent: two
  overlapping runs can't both send.
- Event reminders (deposit to confirm, payout to confirm, handover offered) are sent by the server action itself after the
  write, via `after()`. A push failure never fails or undoes the write.
- No amounts, PINs, phone numbers or balances ever appear in a notification: names and times only.
- Delivery is best effort. Nothing is retried: Home shows the same facts.
- Capacity: each due reminder costs about a quarter second of database round trips and the route has 25 s, so about 80
  reminders per run. Measured 2026-10-11 on the test copy: 807 due reminders took 3.5 minutes. A run cut off at 25 s loses nothing: the
  next run, five minutes later, picks up what is still due inside the hour-long window. Batch the claims before the app has
  dozens of flats.

## When something is off

- Nobody gets reminders: cron-job.org history (last 50 runs). `401` = secret mismatch between cron-job.org and Vercel.
  `200` with `failed > 0` = push service errors; the Vercel function log has one line per failure (endpoint host and code).
- One person gets nothing: they turned it on in another browser, or the browser revoked it (Android: battery settings;
  Windows: Focus assist). Turn off and on again on that browser.
- iPhone: only after Add to Home Screen (iOS 16.4+), then Turn on from the installed app. Not tested in the pilot.
- VAPID keys: rotating them invalidates every subscription; everyone must turn reminders on again.
- Environment: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
