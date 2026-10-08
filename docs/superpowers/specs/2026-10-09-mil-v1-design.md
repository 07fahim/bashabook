# Mil V1: Design Spec

Date: 2026-10-09
Status: Draft, awaiting review
Working name: **Mil (মিল)**. Trademark, Play Store and domain availability not yet checked.

## 1. Product

**Pitch:** The app that runs your shared flat. It tells the cook the daily headcount, rotates bazar duty fairly, splits every cost, and settles dues at month-end without anyone having to play the bad guy.

**For:** Bangladeshi bachelor flats of 8–10 people (friends or strangers) with a hired cook. The flat is the customer. The manager sets it up and pays (price to be tested: ৳199/month guess). Members join free.

**Roles**
- **Member:** marks meal changes and guests, does their bazar turn, logs spending, pays dues.
- **Manager:** a member with extra controls. The role can be handed to another member at any time, for example a monthly rotation.
- **Cook:** cooks and washes clothes. Does not shop and never pays for anything. Has no account; optionally gets a read-only headcount link.

**Core loop:** meals → headcount to cook → members do bazar → costs split → live balances → month-end settlement → dues paid.

**Out of scope for V1:** personal accounts that move between flats, phone or SMS login, chores, inventory, receipt photo scanning, analytics, a menu or feedback system, a marketplace, a native phone app, SMS.

## 2. Stack

- Next.js (App Router), mobile-first, installable as a PWA (manifest + service worker, for Add to Home Screen and Web Push).
- Postgres (Neon or Supabase, used as a plain database only).
- Hosted on Vercel, Singapore region.
- **Scheduler:** Vercel's free (Hobby) plan only allows cron jobs once a day, timed to within ±59 min (checked against Vercel docs on 2026-10-09). So an external free scheduler (cron-job.org) calls `POST /api/cron` hourly with a secret header. Move to Vercel Pro's built-in cron when the app starts charging, since the Hobby plan is also meant for non-commercial use (check the current Vercel terms before launch).
- Web Push using VAPID keys, sent with the `web-push` package.
- UI text in Bangla and English, switchable per member, defaulting to the flat's language.
- Every date calculation uses Dhaka time (Asia/Dhaka).

## 3. Data

| Table | Fields |
|---|---|
| `flats` | id, name, join_code, weight_b, weight_l, weight_d (default 0.5/1/1), cutoff_time (default 22:00), strictness (`relaxed`/`strict`), fund_enabled, bkash_number, language, cook_link_token |
| `rooms` | id, flat_id, name, rent_share_poisha |
| `members` | id, flat_id, name, pin_hash, role (`member`/`manager`), room_id, joined_on, left_on, default_b, default_l, default_d, language, failed_pin_count, locked_until |
| `meal_changes` | member_id, date, meal (`b`/`l`/`d`), count (0 = off, 1 = on, 2+ = with guests), late (bool), status (`ok`/`pending`). Unique on (member_id, date, meal). |
| `duties` | flat_id, date, member_id. Generated from a rotation order; a swap updates two rows. |
| `ledger` | id, flat_id, month, type (`deposit`/`bazar`/`bill`/`payout`), amount_poisha, paid_by_member_id (null = paid from the fund), member_id (for deposit or payout), split (`equal`/`meals`/`room`/`selected`, bills only), date, note, trxid, status (`ok`/`pending`), version, created_by. Unique on (flat_id, trxid). |
| `bill_split_members` | ledger_id, member_id (for `selected`) |
| `bill_templates` | flat_id, name, amount_poisha, split, selected member ids. Copied into the ledger when a month opens. |
| `months` | flat_id, month, status (`open`/`closed`), closed_at |
| `change_requests` | an edit to a closed month or a strict-mode action waiting for manager approval: entity, payload, requested_by, status |
| `audit_log` | entity, entity_id, before, after, by, at |
| `push_subs` | member_id or cook (flat_id), endpoint, keys |
| `sent_jobs` | flat_id, date, job_type. Unique, so no job sends twice. |

If a member has no `meal_changes` row for a date and meal, their default applies. They only count on dates between `joined_on` and `left_on`.

## 4. Money rules

All amounts are whole numbers of **poisha**. No floating point anywhere in the money path.

- **Weighted meals (member, month)** = Σ count × weight for that meal. Guest meals count toward the host.
- **Meal rate** = Σ bazar ÷ Σ weighted meals. Bazar is food only. Soap, gas cylinders and similar go in as bills.
- **Food cost (member)** = the bazar total split by weighted meals, using the allocation method below.
- **Bill share (member)**, depending on the split rule:
  - `equal`: among members present, weighted by the number of days they lived in the flat that month
  - `meals`: weighted by the member's weighted meals
  - `room`: the bill is split across occupied rooms in proportion to their rent_share, then within each room by days present. An empty room blocks closing the month.
  - `selected`: equally among the ticked members (laundry, shared AC)
- **Allocation:** every split works out each member's exact share, rounds it down to whole poisha, then hands out the leftover poisha one at a time to the members with the biggest fractional remainders. Ties go to the lowest member id. Shares always add up exactly to the total.
- **Paid in (member)** = deposits + bazar and bills they paid themselves (`paid_by_member_id` = them)
- **Balance (member)** = paid in − (food cost + bill shares) − payouts they received. Positive means the flat owes them; negative means they owe.
- **Fund** = deposits − bazar and bills paid from the fund − payouts
- **Invariant:** the balances of all members add up to the fund (or to 0 if the fund is off). Checked on every month page load and before closing. If it fails, the month can't be closed and the screen lists the entries involved.
- Pending entries (strict mode, waiting for approval) are left out of every calculation until confirmed.

## 5. Screens

**Getting in**
- Landing page: Create a flat / Join a flat
- Create a flat (manager): flat name → your name and PIN → member names → rooms and rent shares → meal weights, cutoff, fund, bKash number → recurring bills → share the join link (Web Share API, with copy as a fallback)
- Join: link → tap an unclaimed name → set a 4-digit PIN. Claimed name → enter PIN. The session cookie lasts 90 days. 5 wrong tries lock the member for 15 minutes; the manager can reset a PIN.

**Member tabs**
- **Home:** toggles for tomorrow's B/L/D with "locks at HH:MM", balance, today's meal rate, next bazar duty, the "Turn on reminders" button, an iPhone add-to-home-screen guide (shown once)
- **Meals:** week calendar, + guest, away from/to
- **Money:** add bazar (amount, note, paid by me or the fund), pay dues (shows the bKash number, enter TrxID and amount; pending until the manager confirms), the full flat ledger (visible to everyone)
- **Flat:** everyone's balances, meal rate, month totals, the bazar rotation and swap requests

**Manager extras (in the Flat tab)**
- Today's texts: cook headcount, dues reminder, bazar duty. Copy and Share buttons on each.
- Confirm payments, approve change requests
- Members: add, move out (blocked if this is the manager and the role hasn't been handed over), reset PIN, change room, hand over the manager role
- Bills: recurring and one-off
- Close month: invariant check → settlement text → lock → open the next month with recurring bills copied in
- Settings: weights, cutoff, strictness, fund, bKash number, language, rotation order, cook link (create or revoke)

**Cook link:** `/<flat>/cook/<token>`. No login. Shows only tomorrow's and today's counts, and can subscribe to push.

**Strictness**
| | Relaxed | Strict |
|---|---|---|
| Meal change after cutoff | Saved and marked `late` | Becomes a change request |
| Bazar entry | `ok` immediately | `pending` until the manager confirms |
| Editing your own past entry in the open month | Allowed | Becomes a change request |
| Any edit to a closed month | Change request | Change request |

## 6. Automation

`POST /api/cron` runs hourly (external scheduler, secret header). For each flat, in Dhaka time:

| When | Job | Sent to |
|---|---|---|
| cutoff − 1h | Meal reminder | members with push turned on |
| cutoff | Lock tomorrow's meals, send the headcount "Tomorrow: B x / L y / D z" | cook link subscribers + manager |
| 20:00 | Tomorrow's bazar duty | the assigned member |
| 1st of month, 10:00 | "Close last month" | manager |
| month closed, and 3 days later | Dues reminder | members with a negative balance |

Before sending, a job inserts a row into `sent_jobs`. If the row already exists, it skips. If a push endpoint returns 404 or 410, its subscription is deleted. If push fails, the copy/share texts in the manager panel still work.

## 7. Errors and protections

- Two people editing the same entry: the `version` column catches the conflict; the second save gets "changed by someone else, reload".
- Duplicate TrxID: rejected by the unique constraint.
- PIN guessing: lockout as described in Section 5.
- Cross-flat access: every query filters on the session's `flat_id`. There is no endpoint that accepts a flat_id from the client, other than the join code and cook token.
- The invariant stops a broken month from being closed.

## 8. Testing

1. **Money tests:** small months whose results are worked out by hand, each covering one rule: weights and guests, fund plus out-of-pocket payments, `selected` laundry, `room` rent, `equal` prorated for a member who joins on day 11, payouts, pending rows ignored, no meals, an empty room. Every balance is checked to the poisha, and the invariant either holds or blocks closing. (Several small hand-checkable months replaced one large 9-person month, because the large one can't be checked by hand reliably.)
2. **Allocation test:** ৳100.00 split 3 ways gives 3334/3333/3333 poisha, summing to 10000.
3. **Isolation test:** a member of flat A gets nothing back from flat B's routes.
4. **Cron test:** running twice in the same hour sends once; the meal lock applies at the cutoff.
5. Everything else: checked by hand on an Android phone and an iPhone.

## 9. Pilot success

3–5 real flats. Success: at least 3 flats close their **second** month in the app without the builder's help.
