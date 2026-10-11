# BashaBook (বাসাবুক)

Shared-flat accounts for Bangladeshi flats with a hired cook: who ate how many meals, who paid for bazar and bills, who owes whom at month end. A website and an installable web app, English and Bangla.

Live: https://bashabook.fahimfaiyaz.dev

## How it works

- One person per flat holds the flat's money (the collector). Flatmates deposit, the collector pays bazar and bills, every entry shows who and when.
- Meals are counted per person per day; tomorrow's meals lock at the flat's cutoff time so the cook knows how many plates.
- Month end: the collector counts the cash, the app checks it matches, and the month closes with each person's balance carried forward.
- Reminders by web push: an hour before the meal lock, when money needs your confirmation, and when a month is ready to close.

## Stack

Next.js 16 (App Router), React 19, Tailwind 4, Postgres (Neon) through postgres.js, web-push. Tests with Vitest and PGlite. Deployed on Vercel.

## Run it

```
npm install
npm run migrate     # applies db/migrations to the database in .env.local (DATABASE_URL)
npm run dev
npm test
```

Environment: `DATABASE_URL`; for reminders `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (see `ops/reminders.md`).

Operations notes live in `ops/`.
