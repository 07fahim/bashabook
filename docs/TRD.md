# Mil: Technical Requirements Document (V1)

Date: 2026-10-09 (revised after review) · Pairs with `PRD.md`, `schema.sql`, `APP_FLOW.md`, `DESIGN_BRIEF.md`

## 1. Architecture

```
Phone browser (PWA)  ──HTTPS──>  Next.js on Vercel (sin1)  ──>  Postgres (Neon/Supabase, Singapore)
   service worker <── Web Push ── web-push (VAPID)
cron-job.org ── every 5 min POST /api/cron (secret header) ──> Next.js
```

One codebase, one deployed app, one database. No separate backend.

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router), TypeScript, Server Components + Server Actions | Fewest moving parts; Claude Code knows it best |
| UI | Tailwind CSS + shadcn/ui (copied-in components) | Modern, accessible components, no runtime UI library |
| DB access | `postgres` (porsager) with plain SQL | The schema is small; plain SQL keeps the money queries readable |
| Validation | `zod` at every Server Action boundary | User input is untrusted |
| PIN hashing | `bcryptjs` | Pure JS, works on Vercel |
| Push | `web-push` | Standard VAPID sender |
| i18n | Two flat JSON dictionaries (`bn.json`, `en.json`) + a `t()` helper | No i18n framework needed for 2 languages |
| Tests | `vitest`, PGlite for schema tests | Fast, TypeScript-native, real Postgres without Docker |

**Scheduler:** Vercel's free (Hobby) plan only allows cron jobs once a day, with ±59 min timing (Vercel docs, checked 2026-10-09). So cron-job.org (free) calls `/api/cron` every 5 minutes. Switch to Vercel Pro's built-in cron when the app starts charging; the Hobby plan is also meant for non-commercial use (check the current terms).

## 2. Code layout

A member belongs to one flat, so URLs carry no flat id. The session decides the flat.

```
app/
  (marketing)/page.tsx          landing page
  new/page.tsx                  create-flat wizard
  j/[code]/page.tsx             join: pick name, PIN
  (app)/home, meals, money, flat   member tabs
  (app)/manage/                 manager screens
  c/[token]/page.tsx            cook headcount (read-only)
  api/cron/route.ts             scheduled jobs
  api/push/route.ts             save a push subscription
lib/
  money.ts                      pure: allocate(), monthBalances()   ← the core
  meals.ts                      pure: weightedMeals(), daysPresent(), headcount(), isLocked()
  db.ts                         sql client, bigint→number conversion, flat-scoped helpers
  auth.ts                       PIN, sessions, requireMember(), requireManager()
  jobs.ts                       cron job logic
  push.ts                       send + drop dead subscriptions
  i18n/{bn,en}.json
db/migrations/*.sql, db/migrate.ts
public/manifest.webmanifest, sw.js
```

`lib/money.ts` and `lib/meals.ts` are **pure**: data in, numbers out, no database calls. All business correctness lives there and is unit tested.

## 3. Money engine (`lib/money.ts`)

```ts
allocate(total: number, weights: number[]): number[] | null   // poisha; largest remainder, ties → lowest index; null if all weights 0; throws on non-integers
monthBalances(input: MonthInput): { mealRate, perMember: MemberResult[], fund, invariantOk, problems }
```
Poisha are plain `number`s (exact up to ~9×10¹⁵, far beyond any flat's month). Full code and tests: Plan 1, Tasks 2–4.

Rules (spec §4):
1. Weighted meals = Σ count × flat weight, only on dates the member lives in the flat; guests count toward the host.
2. Food cost = `allocate(Σ bazar, weightedMeals)`.
3. Bill share by split rule: `equal` (weights = days present), `meals` (weights = weighted meals), `room` (split across occupied rooms with a share > 0 using rent_share as weights, then within each room by days present), `selected` (equal weights over the ticked members).
4. Balance = opening + paid in (deposits + bazar/bills they paid themselves) − (food cost + bill shares) − payouts received.
5. Fund = opening fund + deposits − bazar/bills paid from the fund − payouts.
6. If Σ balances ≠ fund, the difference is pushed into `problems`. `invariantOk` = no problems. It is an engine self-check; the real-world check is the cash count at close.
7. `status = 'pending'` rows are excluded.
8. Bad data never throws: unknown members, empty rooms with a share, present members without a room, and splits with nobody to split between are returned in `problems`, which blocks closing.

**Loading data:** `postgres` returns `bigint` columns as strings. `lib/db.ts` converts money columns with `Number()` when loading. `allocate` throws a `TypeError` on non-integers, so a missed conversion fails loudly in tests instead of producing wrong numbers.

**Closed months** are never recalculated. At close, `monthBalances` output is written to `month_balances` and `months.closing_fund` / `meal_rate`. The next month's `opening` and `openingFund` come from there, and `memberIds` = members present that month plus anyone with a non-zero opening balance.

**Open month settings:** changing default meals, meal weights, a member's room or a rent share applies back to the first day of the open month. The UI warns before saving; the change is audited.

## 4. Auth and access

- **Join:** `/j/<join_code>` → list of names. Unclaimed → set PIN (4 digits, bcrypt). Claimed → enter PIN.
- **Session:** random 32-byte token in an `httpOnly; Secure; SameSite=Lax` cookie, stored as its SHA-256 hash in `sessions`, lasts 90 days.
- **Lockout:** every 5 failed PINs lock the member for 15 min × 2^(lockouts so far − 1): 15 min, 30, 60 and so on. `failed_pin_count` resets on a successful login. The manager sees failed counts.
- **Reset:** the manager sets a one-time PIN (`must_change_pin = true`); the member must choose a new PIN at next login. The name never becomes unclaimed. Reset clears `failed_pin_count` and `locked_until`, and deletes that member's sessions.
- **Move-out** deletes the member's sessions. A leaver can log in again read-only, to see their final balance and submit a dues TrxID.
- **Scoping:** `requireMember()` returns `{memberId, flatId, role}` from the session. Every query takes `flatId` **from the session, never from the URL or form**. Composite foreign keys in the schema reject cross-flat references as a second line of defence.
- **Manager actions:** `requireManager()`.
- **Cook link:** a random 24-byte token; the manager can revoke or regenerate it. Read-only headcount, nothing else.
- Skipped: a per-IP rate limiter. Add it if abuse shows up.

## 5. Meals and cutoff

- Effective count(member, date, meal) = the `meal_changes` row if one exists, else the member default (1/0), else 0 when outside joined_on..left_on.
- `isLocked(date, nowDhaka, cutoff)`: a date is locked once it is today or earlier, or it is tomorrow and the Dhaka clock has passed the cutoff. Accepts `HH:MM` or Postgres `HH:MM:SS`.
- After lock: relaxed mode → save with `late = true`; strict mode → create a `change_request`.

## 6. Strictness

| Action | Relaxed | Strict |
|---|---|---|
| Meal change after cutoff | `late = true` | change_request |
| New bazar entry | `ok` | `pending` |
| Edit own entry (open month) | direct, audited | change_request |
| Anything in a closed month | change_request | change_request |
| Deposit with TrxID | `pending` until manager confirms | same |

Every insert, update or delete on `ledger` and `meal_changes` writes an `audit_log` row in the same transaction.

## 7. Concurrency

Updates to `ledger` use `where id = $1 and version = $2`, then `version + 1`. Zero rows updated → the user sees a reload message. `meal_changes` uses upsert (last write wins; audited).

## 8. Month close

Close gate (all must pass):
1. `monthBalances(...).problems` is empty
2. no `pending` ledger rows in the month
3. no `pending` change requests
4. the manager's cash count equals the computed fund

Then, in one transaction: write `month_balances` rows, set `months.status = 'closed'`, `closing_fund`, `cash_counted`, `meal_rate`, `closed_at`.

- **Month rows** are created on the first write dated in a new month or by cron on the 1st (`insert ... on conflict do nothing`), which also copies `bill_templates` into it. `selected_member_ids` are checked against the flat's members during the copy.
- **Provisional opening:** while the previous month is open, the new month's opening = the previous month's live `monthBalances` result, shown as provisional.
- **Closed-month corrections:** approving a change request on a closed month inserts a correcting ledger row in the open month, noting the original id. Closed months are never edited.
- **Open-month settings changes** apply from the first day of the oldest open month.

## 9. Scheduled jobs (`/api/cron`, every 5 min)

Checks the `CRON_SECRET` header. For each flat, using Dhaka time:

| Condition | Job type | Action |
|---|---|---|
| now within [cutoff − 1h, cutoff) | `meal_reminder` | push to members |
| now ≥ cutoff | `headcount` | push tomorrow's counts to cook subscribers + manager |
| now ≥ 20:00 | `duty` | push to tomorrow's duty member |
| day = 1, now ≥ 10:00, last month open | `close_reminder` | push to manager |
| on close, and close + 3 days | `dues` / `dues_followup` | push to members with a negative balance |

Run-once: `insert into sent_jobs ... on conflict do nothing returning 1`; send only if a row came back. A push 404/410 → delete that subscription. The meal lock itself is **calculated from the clock** (§5), not set by cron.

## 10. PWA

- `manifest.webmanifest` (name, icons 192/512, `display: standalone`, theme colour).
- `sw.js`: handles `push` and `notificationclick` only, plus a cached offline page. No offline data sync in V1.
- iPhone: detect iOS Safari when not installed → show a one-time Add to Home Screen guide (push needs iOS 16.4+ and an installed app).

## 11. Performance and limits

- Target: first load < 150 KB JS on the member screens; time to interactive < 3 s on a slow 4G connection. Server-render everything; use client components only for toggles and forms.
- Scale: 10 members × 3 meals × 31 days = ~930 meal facts a month per flat. The open month is computed per request from raw rows; closed months read the snapshot.

## 12. Security checklist

- All input validated with zod; amounts are positive integers in poisha; TrxID is 8–12 alphanumeric characters.
- Parameterised SQL only (tagged templates).
- Secrets in Vercel env: `DATABASE_URL`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- No personal data beyond name, PIN hash and room. bKash number only for the manager.
- HTTPS only; `Secure` cookies; Next's built-in origin check on Server Actions.

## 13. Testing

| Test | Proves |
|---|---|
| `money.test.ts` | allocate exact and integer-only; hand-checked months: out-of-pocket bazar + fund bills + selected laundry; carry-forward and settlement; rent by room; empty, zero-share and missing rooms; payouts and pending ignored; no meals; unknown members |
| `meals.test.ts` | weights, guests, join date proration, headcount, lock at cutoff across month and year ends, Postgres time format |
| `schema.test.ts` | one manager, bills need a split, unique TrxID, ledger date inside its month, cross-flat references rejected |
| `isolation.test.ts` (Plan 3) | Flat A's session can't read flat B |
| `jobs.test.ts` (Plan 7) | Running cron twice sends once |

Manual: the full month flow on one Android phone and one iPhone.

## 14. Environments and branches

`local` (PGlite for tests, Neon dev branch for the app) → `preview` (Vercel previews per PR) → `prod`. Migrations: numbered `.sql` files applied by `npm run migrate`, recorded in a `migrations` table. Every feature is built on its own branch and merged through a reviewed PR.
