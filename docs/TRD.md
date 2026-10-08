# Mil: Technical Requirements Document (V1)

Date: 2026-10-09 · Pairs with `PRD.md`, `schema.sql`, `APP_FLOW.md`, `DESIGN_BRIEF.md`

## 1. Architecture

```
Phone browser (PWA)  ──HTTPS──>  Next.js on Vercel (sin1)  ──>  Postgres (Neon/Supabase, Singapore)
   service worker <── Web Push ── web-push (VAPID)
cron-job.org ── hourly POST /api/cron (secret header) ──> Next.js
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
| Tests | `vitest` | Fast, TypeScript-native |

**Scheduler:** Vercel's free (Hobby) plan only allows cron jobs once a day, with ±59 min timing (Vercel docs, checked 2026-10-09). So cron-job.org (free) calls `/api/cron` hourly. Switch to Vercel Pro's built-in cron when the app starts charging; the Hobby plan is also meant for non-commercial use (check the current terms).

## 2. Code layout

```
app/
  (marketing)/page.tsx          landing page
  new/page.tsx                  create-flat wizard
  j/[code]/page.tsx             join: pick name, PIN
  f/[flatId]/(member)/          home, meals, money, flat tabs
  f/[flatId]/manage/            manager screens
  c/[token]/page.tsx            cook headcount (read-only)
  api/cron/route.ts             hourly jobs
  api/push/route.ts             save a push subscription
lib/
  money.ts                      pure functions: allocate(), monthBalances()  ← the core
  meals.ts                      effectiveMeals(), headcount()
  db.ts                         sql client + flat-scoped query helpers
  auth.ts                       PIN, sessions, requireMember(), requireManager()
  jobs.ts                       cron job logic
  push.ts                       send + drop dead subscriptions
  i18n/{bn,en}.json
public/manifest.webmanifest, sw.js
```

`lib/money.ts` and `lib/meals.ts` are **pure**: data in, numbers out, no database calls. All business correctness lives there and is unit tested.

## 3. Money engine (`lib/money.ts`)

```ts
allocate(total: number, weights: number[]): number[] | null   // poisha; largest-remainder, ties → lowest index; null if all weights 0
monthBalances(input: MonthInput): { mealRate, perMember: MemberResult[], fund, invariantOk, problems }
```
Poisha are plain `number`s (exact up to ~9×10¹⁵, far beyond any flat's month). Full code and tests: Plan 1, Tasks 2–4.

Rules (from the spec, §4):
1. Weighted meals = Σ count × flat weight, only on dates the member lives in the flat; guests count toward the host.
2. Food cost = `allocate(Σ bazar, weightedMeals)`.
3. Bill share by split rule: `equal` (weights = days present), `meals` (weights = weighted meals), `room` (the bill is split across *occupied* rooms using rent_share as weights, then within each room by days present; an empty room blocks the close), `selected` (equal weights over the ticked members).
4. Balance = paid in (deposits + bazar/bills they paid themselves) − (food cost + bill shares) − payouts received.
5. Fund = deposits − bazar/bills paid from the fund − payouts.
6. **Invariant:** Σ balances = fund (or 0 if there's no fund). Proof: Σ costs = Σ all bazar + bills, so Σ balances = deposits + member-paid − all spending − payouts = fund.
7. `status = 'pending'` rows are excluded. Meal weights are converted to integer hundredths before any arithmetic.

Edge cases: a month with zero weighted meals → meal rate is 0 and the bazar is flagged as "unallocated" (the month can't be closed); a `room` bill with an empty room → that room's share is flagged.

## 4. Auth and access

- **Join:** `/j/<join_code>` → list of names. Unclaimed → set PIN (4 digits, bcrypt). Claimed → enter PIN.
- **Session:** random 32-byte token in an `httpOnly; Secure; SameSite=Lax` cookie, stored as its SHA-256 hash in `sessions`, lasts 90 days.
- **Lockout:** 5 failed PINs → `locked_until = now + 15 min`. Manager can reset (clears `pin_hash`).
- **Scoping:** `requireMember()` returns `{memberId, flatId, role}` from the session. Every query takes `flatId` **from the session, never from the URL or form**. The URL `flatId` must match, or the response is 404.
- **Manager actions:** `requireManager()`.
- **Cook link:** a random 24-byte token; the manager can revoke or regenerate it. Read-only headcount, nothing else.
- **Rate limit:** PIN attempts per IP via a simple DB counter. (Skipped otherwise: no global rate limiter until abuse shows up.)

## 5. Meals and cutoff

- Effective count(member, date, meal) = the `meal_changes` row if one exists, else the member default (1/0), else 0 when outside joined_on..left_on.
- "Tomorrow is locked" when the Dhaka time now ≥ cutoff on the day before.
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

Updates to `ledger` use `where id = $1 and version = $2`, then `version + 1`. Zero rows updated → "changed by someone else, reload". `meal_changes` uses upsert (last write wins; audited).

## 8. Scheduled jobs (`/api/cron`, hourly)

Checks the `CRON_SECRET` header. For each flat, using Dhaka time:

| Condition | Job type | Action |
|---|---|---|
| now within [cutoff − 1h, cutoff) | `meal_reminder` | push to members |
| now ≥ cutoff | `headcount` | push tomorrow's counts to cook subscribers + manager |
| now ≥ 20:00 | `duty` | push to tomorrow's duty member |
| day = 1, now ≥ 10:00, last month open | `close_reminder` | push to manager |
| month closed (on close) and +3 days | `dues` / `dues_followup` | push to members with a negative balance |

Run-once: `insert into sent_jobs ... on conflict do nothing returning 1`; send only if a row came back. A push 404/410 → delete that subscription. The cutoff lock itself is **calculated from the clock** (§5), not set by cron, so a missed cron run never leaves meals unlocked.

## 9. PWA

- `manifest.webmanifest` (name, icons 192/512, `display: standalone`, theme colour).
- `sw.js`: handles `push` and `notificationclick` only, plus a cached offline page. No offline data sync in V1.
- iPhone: detect iOS Safari when not installed → show a one-time Add to Home Screen guide (push needs iOS 16.4+ and an installed app).

## 10. Performance and limits

- Target: first load < 150 KB JS on the member screens; time to interactive < 3 s on a slow 4G connection. Server-render everything; use client components only for toggles and forms.
- Scale: 10 members × 3 meals × 31 days = ~930 meal facts a month per flat. Balances are computed on each request from raw rows, with no cached totals. (ponytail: recomputed per request; add a monthly snapshot table if one flat page goes over ~200 ms.)

## 11. Security checklist

- All input validated with zod; amounts are positive integers in poisha; TrxID is 8–12 alphanumeric characters.
- Parameterised SQL only (tagged templates).
- Secrets in Vercel env: `DATABASE_URL`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
- No personal data beyond name, PIN hash and room. bKash number only for the manager.
- HTTPS only; `Secure` cookies; a CSRF guard on Server Actions (Next's built-in origin check).

## 12. Testing

| Test | Proves |
|---|---|
| `money.test.ts`: hand-checked months: out-of-pocket bazar + fund-paid bills + selected laundry; rent by room; payouts + pending ignored; no meals; empty room | Every balance correct to the poisha; invariant holds or blocks |
| `meals.test.ts` + `allocate`: weights, guests, member joining day 11 (21/31-day proration) | Proration and weights are exact |
| `money.test.ts`: `allocate(10000n,[1,1,1]) → [3334n,3333n,3333n]` | Rounding is exact |
| `meals.test.ts`: defaults, changes, guest, outside the stay, lock boundary at cutoff | Headcount is right |
| `isolation.test.ts` | Flat A's session can't read flat B |
| `jobs.test.ts` | Running cron twice sends once |

Manual: the full month flow on one Android phone and one iPhone.

## 13. Environments

`local` (Docker Postgres) → `preview` (Vercel previews + Neon branch) → `prod`. Migrations: numbered `.sql` files applied by a 20-line script that records them in a `migrations` table.
