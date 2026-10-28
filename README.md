<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.png">
    <img src=".github/assets/logo-light.png" alt="BashaBook (বাসাবুক)" width="420">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4">
  <img src="https://img.shields.io/badge/Postgres-Supabase-4169E1?logo=postgresql&logoColor=white" alt="Postgres on Supabase">
  <img src="https://img.shields.io/badge/Vercel-Singapore-000000?logo=vercel&logoColor=white" alt="Vercel, Singapore">
  <img src="https://img.shields.io/badge/PWA-installable-5A0FC8?logo=pwa&logoColor=white" alt="Installable web app">
</p>

<p align="center">
  <a href="https://bashabook.fahimfaiyaz.dev"><img src=".github/assets/month-end.gif" alt="Month end in BashaBook: the collector counts the cash and sees it is short, the settle-up lines go to the flat's group chat, and the month exports as a CSV." width="800"></a>
</p>

Watch the full 60-second film, with sound:

https://github.com/user-attachments/assets/823c4a9c-1a36-43f2-86b0-076452d7e9e5

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

**Meals.** Breakfast, lunch and dinner per person per day. Tomorrow's meals lock at the flat's cutoff time so the cook knows how many plates to make. Guests count as extra plates on your line. No-cooking days, days away, moving in and out mid-month, and a history of every change. A month grid shows the whole month at once.

**Money.** One page for the month: Add bazar, Add bill (rent by room, equal, by meals, or for chosen people), I paid; Give money (an advance from the flat) on the Flat tab. Money paid in or given out can say how it moved: cash, bKash, Nagad or bank. Every entry shows who saved it and when; the receiver confirms any money between two people. Your balance breakdown shows how your line adds up, to the poisha. The collector can open anyone's breakdown and share it.

**Charts.** The month as a dashboard: a strip of numbers, the spend climbing through the month, where the money went, your meals and your month as a receipt that adds up, the last six months, and for the collector everyone's cost. A forecast of where the month ends at this pace, and, only when there is something to ask, questions about an entry saved twice, a bazar bigger than any before, or a usual bill that has not come.

**Flat.** For the collector: people and rooms, rent shares, meal weights and the cutoff, the join code, handover of the money and the role, and the close card.

**Month end.** The collector counts cash, bKash, Nagad and bank. The month closes only when the total matches what the app says the flat holds. Balances freeze, each person's line carries into next month, and the settle-up lines say who pays whom. Mistakes found later go in as corrections that never change a closed month's cash. The collector can download a closed month as a CSV: its entries, then each person's line.

```mermaid
flowchart TD
  M["Meals marked by each person"] --> L["Each person's line adds up through the month"]
  E["Bazar, bills, deposits, advances"] --> L
  L --> C{"After the month ends, the collector counts cash, bKash, Nagad and bank"}
  C -- "matches, and no entry waits for a tap" --> F["Month closes and balances freeze"]
  C -- "does not match, or an entry still waits" --> O["Month stays open until it does"]
  F --> S["Settle-up lines: who pays whom"]
  F --> N["Each line carries into next month"]
  F -. "a mistake found later" .-> K["Correction in an open month; the closed month never changes"]
```

**Reminders.** Web push: an hour before the meal lock, when money needs your confirmation, and when a month is ready to close. No amounts in a notification.

## How the money is counted

- All amounts are integer poisha. Splits use largest-remainder allocation, so shares always add up to the total exactly.
- Food cost is the month's bazar split by weighted meals; the meal rate shown is bazar divided by meals, for display only.
- Each person's line is opening balance + paid in − food − bill share − advances + corrections. The sum of all lines always equals the flat's money; the app refuses to close a month where it does not.
- A closed month is a snapshot. Nothing recalculates it later.

The core tables (the full schema is in `db/migrations/`). Rows point at members, rooms and months through composite foreign keys (the flat's id plus the row's key), so the database refuses a link to another flat's person, room or month; the few links it cannot express are checked by the app.

```mermaid
erDiagram
  flats ||--o{ rooms : has
  flats ||--o{ members : has
  flats ||--o{ months : has
  rooms |o--o{ members : "rent share"
  members ||--o{ meal_changes : marks
  months ||--o{ ledger : holds
  members |o--o{ ledger : "pays or receives"
  months ||--o{ month_balances : "frozen at close"
  members ||--o{ month_balances : has
  flats {
    uuid id
    text join_code
    time cutoff_time
  }
  rooms {
    text name
    bigint rent_share_poisha
  }
  members {
    uuid id
    text name
    text pin_hash "bcrypt"
    date joined_on
    date left_on
  }
  meal_changes {
    date date
    char meal "b, l or d"
    int count "own plate plus guests"
    int guests
  }
  months {
    date month
    text status "open or closed"
    jsonb cash "counted at close"
  }
  ledger {
    text type "deposit, bazar, bill, payout, adjustment"
    bigint amount_poisha
    text split "bills only: equal, meals, room, selected"
    text method "deposits and payouts only: cash, bkash, nagad, bank"
    text status "ok or pending"
  }
  month_balances {
    bigint opening
    bigint paid_in
    bigint food_cost
    bigint bill_share
    bigint payouts
    bigint adjustments
    bigint balance
  }
```

## Privacy

A flatmate sees the flat's entries and everyone's balance, and only their own line-by-line breakdown (the collector can open anyone's). Nothing is sent to any AI service. The live site counts visits with Google Analytics 4, which sets its own cookie and collects what its tag always does (device, browser, rough location from the IP, time on page). The app tells it page addresses with a join link's flat code hidden and no query strings, and never names, phone numbers, amounts or anything typed in. Setup: `ops/analytics.md`. The full policy is on the site's [privacy page](https://bashabook.fahimfaiyaz.dev/en/privacy). The app is free and says so; there is no plan behind it.

Limits: a flat holds up to 30 names, counting people who moved out. Creating flats, join-code lookups and PIN tries are rate-limited per IP address, and the counts are deleted after about two hours. A trial flat nobody used (no entries, no meal changes, at most one person set a PIN, nothing in its history for a month) is deleted once it is a month old.

## Stack

Next.js 16 (App Router, server components and actions), React 19, TypeScript, Tailwind CSS 4, Postgres on Supabase through postgres.js with plain SQL migrations, bcryptjs for PINs, web-push for reminders. Charts are hand-drawn SVG; there is no chart or UI library. Six runtime dependencies.

```mermaid
flowchart TD
  B["Phone or laptop browser: the website and the installed app, with a service worker for reminders"]
  V["Next.js on Vercel, Singapore: pages, server actions, the money and meals engines"]
  D[("Postgres on Supabase")]
  P["Browser push service"]
  C["cron-job.org, every 5 minutes"]
  G["Google Analytics 4"]
  B <--> V
  V <--> D
  C -- "GET /api/cron with a secret: reminders and clean-up" --> V
  V -- "web push, no amounts" --> P
  P --> B
  B -. "page addresses, join codes hidden" .-> G
```

Tests: Vitest with PGlite (Postgres in process) for the schema and money engine, a WCAG contrast test, and Playwright drives for the pages. CI on every PR: typegen, tsc, eslint, vitest. Deployed on Vercel (Singapore), previews per PR.

## Run it

```
npm install
npm run migrate     # applies db/migrations to the database in .env.local (DATABASE_URL)
npm run dev
npm test
npm run build
```

Environment: `DATABASE_URL`; for reminders `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET` (see `ops/reminders.md`); for analytics `NEXT_PUBLIC_GA_ID`, production only (see `ops/analytics.md`). A cron job calls `GET /api/cron` every five minutes with the secret.

## Layout of the repo

- `app/[lang]/` pages and server actions, one dictionary for both languages in `dictionaries.ts`
- `lib/` the money and meals engines (pure, tested), database access, auth, close, handover, notifications
- `db/migrations/` numbered SQL, applied in order
- `scripts/` operations scripts (delete a flat, reset a collector's PIN, race tests against a test copy)
- `ops/` operations notes: reminders, PIN recovery, data retention, analytics, and the welcome note for a new flat's group chat

## Status

Live since October 2026. Not now, by decision: an AI assistant, live sync with spreadsheets, a personal spending diary. Features come from what flats ask for.
