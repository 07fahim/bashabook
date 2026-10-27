# BashaBook (বাসাবুক)

Shared-flat accounts for Bangladeshi flats of eight to ten people with a hired cook. Who ate how many plates, who paid for bazar and bills, what each person owes or gets back, and a month end that closes only when the cash in hand matches the books.

A website and an installable web app (PWA), designed for a 360 px phone and for a full laptop screen. English and Bangla, both first-class.

Live: https://bashabook.fahimfaiyaz.dev · Free to use.

## Who it is for

Every flat has one person who holds the money and keeps the khata. BashaBook is that khata, shared with everyone in the flat so nobody has to ask "why do I owe this?" at month end.

- **The collector** holds the flat's money, saves bazar and bills, confirms deposits, closes the month and hands over to the next collector when they move out.
- **Flatmates** mark their own meals and guests, deposit money, and watch their own line add up through the month.
- **The cook** gets tomorrow's plate count as a message anyone can forward from their phone.

## What it does

**Home.** Today's plates, your line (owe or get back), money waiting for your tap, the week's meals, and reminders you can turn on.

**Meals.** Breakfast, lunch and dinner per person per day. Tomorrow's meals lock at the flat's cutoff time so the cook knows how many plates to make. Guests count as extra plates on your line. No-cooking days, days away, moving in and out mid-month, and a history of every change.

**Money.** One page for the month: Add bazar, Add bill (rent by room, equal, by meals, or for chosen people), I paid; Give money (an advance from the flat) on the Flat tab. Every entry shows who saved it and when; the receiver confirms any money between two people. Your balance breakdown shows how your line adds up, to the poisha. The collector can open anyone's breakdown and share it.

**Charts.** The month as a dashboard: a strip of numbers, the spend climbing through the month, where the money went, your meals and your month as a receipt that adds up, the last six months, and for the collector everyone's cost. A forecast of where the month ends at this pace, and, only when there is something to ask, questions about an entry saved twice, a bazar bigger than any before, or a usual bill that has not come.

**Flat.** For the collector: people and rooms, rent shares, meal weights and the cutoff, the join code, handover of the money and the role, and the close card.

**Month end.** The collector counts cash, bKash, Nagad and bank. The month closes only when the total matches what the app says the flat holds. Balances freeze, each person's line carries into next month, and the settle-up lines say who pays whom. Mistakes found later go in as corrections that never change a closed month's cash.

**Reminders.** Web push: an hour before the meal lock, when money needs your confirmation, and when a month is ready to close. No amounts in a notification.

## How the money is counted

- All amounts are integer poisha. Splits use largest-remainder allocation, so shares always add up to the total exactly.
- Food cost is the month's bazar split by weighted meals; the meal rate shown is bazar divided by meals, for display only.
- Each person's line is opening balance + paid in − food − bill share − advances + corrections. The sum of all lines always equals the flat's money; the app refuses to close a month where it does not.
- A closed month is a snapshot. Nothing recalculates it later.

## Privacy

A flatmate sees the flat's entries and their own breakdown, never another person's food cost, bill share or deposits. Nothing is sent to any AI service. The live site counts visits with Google Analytics, which sets its own cookies: page addresses only, with a join link's flat code hidden and no member ids, and never names, phone numbers, amounts or anything typed into the app. The app is free and says so; there is no plan behind it.

## Stack

Next.js 16 (App Router, server components and actions), React 19, TypeScript, Tailwind CSS 4, Postgres on Neon through postgres.js with plain SQL migrations, bcryptjs for PINs, web-push for reminders. Charts are hand-drawn SVG; there is no chart or UI library. Six runtime dependencies.

Tests: Vitest with PGlite (Postgres in process) for the schema and money engine, a WCAG contrast test, and Playwright drives for the pages. CI on every PR: typegen, tsc, eslint, vitest. Deployed on Vercel (Singapore), previews per PR.

## Run it

```
npm install
npm run migrate     # applies db/migrations to the database in .env.local (DATABASE_URL)
npm run dev
npm test
npm run build
```

Environment: `DATABASE_URL`; for reminders `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (see `ops/reminders.md`). A cron job calls `GET /api/cron` every five minutes with the secret.

## Layout of the repo

- `app/[lang]/` pages and server actions, one dictionary for both languages in `dictionaries.ts`
- `lib/` the money and meals engines (pure, tested), database access, auth, close, handover, notifications
- `db/migrations/` numbered SQL, applied in order
- `scripts/` operations scripts (delete a flat, reset a collector's PIN, race tests against a test copy)
- `ops/` operations notes: reminders, PIN recovery, data retention

## Status

Live since October 2026. Not now, by decision: an AI assistant, spreadsheet export, a personal spending diary. Features come from what flats ask for.
