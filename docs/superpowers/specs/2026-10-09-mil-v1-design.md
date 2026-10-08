# Mil V1: Design Spec

Date: 2026-10-09 (revised after review)
Status: Draft, awaiting review
Working name: **Mil (মিল)**. Trademark, Play Store and domain availability not yet checked.

## 1. Product

**Pitch:** The app that runs your shared flat. It tells the cook the daily headcount, rotates bazar duty fairly, splits every cost, and settles dues at month-end without anyone having to play the bad guy.

**For:** Bangladeshi bachelor flats of 8–10 people (friends or strangers) with a hired cook. The flat is the customer. The manager sets it up and pays (price to be tested: ৳199/month guess). Members join free.

**Roles**
- **Member:** marks meal changes and guests, does their bazar turn, logs spending, pays dues.
- **Manager:** a member with extra controls. The role can be handed to another member at any time, for example a monthly rotation.
- **Cook:** cooks and washes clothes. Does not shop and never pays for anything. Has no account; optionally gets a read-only headcount link.

**The fund:** the cash and bKash the manager holds for the flat. It always exists. Deposits go into it; bazar and bills can be paid from it or out of a member's own pocket; payouts come out of it. A flat that never collects deposits still works: its fund just stays near zero until settlement.

**Core loop:** meals → headcount to cook → members do bazar → costs split → live balances → month-end settlement → dues paid, carried into next month.

**Out of scope for V1:** personal accounts that move between flats, phone or SMS login, chores, inventory, receipt photo scanning, analytics, a menu or feedback system, a marketplace, a native phone app, SMS, duty swap requests (the manager reassigns turns), a fund on/off switch.

## 2. Stack

- Next.js (App Router), mobile-first, installable as a PWA (manifest + service worker, for Add to Home Screen and Web Push).
- Postgres (Neon or Supabase, used as a plain database only).
- Hosted on Vercel, Singapore region.
- **Scheduler:** Vercel's free (Hobby) plan only allows cron jobs once a day, timed to within ±59 min (checked against Vercel docs on 2026-10-09). So an external free scheduler (cron-job.org) calls `POST /api/cron` **every 5 minutes** with a secret header. Move to Vercel Pro's built-in cron when the app starts charging, since the Hobby plan is also meant for non-commercial use (check the current Vercel terms before launch).
- Web Push using VAPID keys, sent with the `web-push` package.
- UI text in Bangla and English, switchable per member, defaulting to the flat's language.
- Every date calculation uses Dhaka time (Asia/Dhaka).

## 3. Data

The full definition is `docs/schema.sql`. Every child row carries `flat_id` and uses composite foreign keys, so nothing can point at another flat's rows.

| Table | Purpose |
|---|---|
| `flats` | name, join code, meal weights in hundredths (default 50/100/100), cutoff time (default 22:00), strictness, bKash number, language, bazar rotation order, cook link token |
| `rooms` | name, rent share |
| `members` | name, PIN hash, must_change_pin, role, room, joined_on, left_on, default meals, language, failed PIN count, locked_until |
| `meal_changes` | saved meal changes only: member, date, meal, count (0 off, 1 on, 2+ with guests), late |
| `duties` | date → member for bazar |
| `months` | open/closed, plus at close: closing fund, cash counted, meal rate |
| `ledger` | deposit / bazar / bill / payout, with amount, who paid (null = fund), split, TrxID, status (ok/pending), version |
| `bill_split_members` | members ticked on a `selected` bill |
| `bill_templates` | recurring bills copied into each new month |
| `month_balances` | frozen per-member result of each closed month |
| `change_requests` | edits waiting for manager approval |
| `audit_log`, `push_subs`, `sent_jobs`, `sessions` | history, push subscriptions, run-once job records, logins |

If a member has no `meal_changes` row for a date and meal, their default applies. They only count on dates between `joined_on` and `left_on`.

**Two approval mechanisms, one rule each:** new ledger rows that need approval are saved with `status = 'pending'`. Any change to an existing row, and any meal change after the cutoff in strict mode, is a `change_request`. `meal_changes` has no pending state.

## 4. Money rules

All amounts are whole numbers of **poisha**. No floating point anywhere in the money path.

- **Weighted meals (member, month)** = Σ count × weight for that meal. Guest meals count toward the host.
- **Meal rate** = Σ bazar ÷ Σ weighted meals. Bazar is food only. Soap, gas cylinders and similar go in as bills.
- **Food cost (member)** = the bazar total split by weighted meals.
- **Bill share (member)**, depending on the split rule:
  - `equal`: among members present, weighted by the number of days they lived in the flat that month
  - `meals`: weighted by the member's weighted meals
  - `room`: the bill is split across occupied rooms in proportion to their rent_share, then within each room by days present. An empty room with a rent share, or a present member with no room, blocks closing the month. Rooms with a zero share are ignored.
  - `selected`: equally among the ticked members (laundry, shared AC)
- **Allocation:** every split works out each member's exact share, rounds it down to whole poisha, then hands out the leftover poisha one at a time to the members with the biggest fractional remainders. Ties go to the first member. Shares always add up exactly to the total.
- **Opening balance (member)** = their balance in the last closed month's `month_balances`. **Opening fund** = that month's `closing_fund`.
- **Paid in (member)** = deposits + bazar and bills they paid themselves.
- **Balance (member)** = opening + paid in − (food cost + bill shares) − payouts they received. Positive means the flat owes them; negative means they owe.
- **Fund** = opening fund + deposits − bazar and bills paid from the fund − payouts.
- **Engine self-check:** Σ balances = fund. If they differ (an engine bug, or an opening balance for someone missing from the month), the difference is added to problems, so the close gate catches it. It is not a trust feature.
- **Cash count:** at close, the manager enters the cash + bKash they actually hold. It must match the computed fund. This is the check that catches a wrong or missing entry.
- **Close gate:** a month can close only when there are no problems, no pending ledger rows, no pending change requests, and the cash count matches the fund.
- **At close:** each member's result is written to `month_balances`, and the month's closing fund and meal rate are written to `months`. A closed month is always shown from this snapshot, never recalculated.
- **New months open on their own:** a month row is created on the first write dated in it, or by cron on the 1st (`on conflict do nothing`), so entries are never blocked waiting for the previous close. While the previous month is still open, the new month's opening balances are that month's live results, marked provisional.
- **Corrections to a closed month:** an approved change request never edits the closed month. It becomes a new ledger row in the open month, with a note pointing to the original entry.
- **Changes inside an open month:** changing a member's default meals, the flat's meal weights, a member's room or a room's rent share applies back to the first day of the oldest open month. The settings screen says so before saving, and the change is audited. Closed months are unaffected because they read the snapshot.
- **Move-out:** a leaver's balance becomes final when the month closes, because bazar bought later in the month is still shared over the whole month. Their balance carries into the next month like anyone else's, and the manager settles it with a deposit or payout.
- Pending entries are left out of every calculation until confirmed.

## 5. Screens

**Getting in**
- Landing page: Create a flat / Join a flat
- Create a flat (manager): flat name → your name and PIN → member names → rooms and rent shares → meal weights, cutoff, bKash number → recurring bills → share the join link (Web Share API, with copy as a fallback)
- Join: `/j/<join code>` → tap an unclaimed name → set a 4-digit PIN. Claimed name → enter PIN. The session cookie lasts 90 days.
- **PIN safety:** after 5 wrong tries the member is locked for 15 minutes, and each further lockout doubles the wait. The manager sees failed-attempt counts. A manager reset sets a one-time PIN that the member must change at next login (the name never becomes unclaimed), and clears the failed count and any lockout. Resetting a PIN or recording a move-out deletes that member's sessions. A leaver can still log in, read only, to see their final balance and submit a dues TrxID.

**Member tabs** (URLs have no flat id; the session decides the flat)
- **Home:** toggles for tomorrow's B/L/D with "locks at HH:MM", balance, today's meal rate, next bazar duty, the Turn on reminders button, an iPhone add-to-home-screen guide (shown once)
- **Meals:** week calendar, + guest, away from/to
- **Money:** add bazar (amount, note, paid by me or the fund), pay dues (shows the bKash number, enter TrxID and amount; pending until the manager confirms), the full flat ledger (visible to everyone)
- **Flat:** everyone's balances, meal rate, month totals, the bazar rotation

**Manager extras (in the Flat tab)**
- Today's texts: cook headcount, dues reminder, bazar duty. Copy and Share buttons on each.
- Confirm payments, approve change requests
- Members: add, move out (blocked if this is the manager and the role hasn't been handed over), reset PIN, change room, hand over the manager role
- Bills: recurring and one-off
- Bazar duty: reassign a day to another member
- Close month: the close gate checklist → cash count → settlement text → lock → open the next month with carried balances and recurring bills
- Settings: weights, cutoff, strictness, bKash number, language, rotation order, cook link (create or revoke)

**Cook link:** `/c/<token>`. No login. Shows only tomorrow's and today's counts, and can subscribe to push.

**Strictness**
| | Relaxed | Strict |
|---|---|---|
| Meal change after cutoff | Saved and marked `late` | Becomes a change request |
| Bazar entry | `ok` immediately | `pending` until the manager confirms |
| Editing your own past entry in the open month | Allowed | Becomes a change request |
| Any edit to a closed month | Change request | Change request |

## 6. Automation

`POST /api/cron` runs every 5 minutes (external scheduler, secret header). For each flat, in Dhaka time:

| When | Job | Sent to |
|---|---|---|
| cutoff − 1h | Meal reminder | members with push turned on |
| cutoff | Headcount: Tomorrow B x / L y / D z | cook link subscribers + manager |
| 20:00 | Tomorrow's bazar duty | the assigned member |
| 1st of month, 10:00 | Close last month | manager |
| month closed, and 3 days later | Dues reminder | members with a negative balance |

Before sending, a job inserts a row into `sent_jobs`. If the row already exists, it skips. If a push endpoint returns 404 or 410, its subscription is deleted. If push fails, the copy/share texts in the manager panel still work. The meal lock itself comes from the clock, not from cron, so a missed run never leaves meals unlocked.

## 7. Errors and protections

- Two people editing the same entry: the `version` column catches the conflict; the second save gets a reload message.
- Duplicate TrxID: rejected by the unique constraint.
- PIN guessing: escalating lockout, as described in Section 5.
- Cross-flat access: every query filters on the session's `flat_id`, and composite foreign keys in the database reject cross-flat references.
- Bad data reaching the engine (unknown member, empty room, no room) is reported as a problem that blocks closing, never a crash.

## 8. Testing

1. **Money tests:** small months whose results are worked out by hand, each covering one rule: weights and guests, fund plus out-of-pocket payments, `selected` laundry, `room` rent (including empty and zero-share rooms and a member with no room), `equal` prorated for a member who joins on day 11, payouts, pending rows ignored, no meals, unknown members, and carry-forward from one month to the next. Every balance is checked to the poisha.
2. **Allocation test:** ৳100.00 split 3 ways gives 3334/3333/3333 poisha, summing to 10000; non-integers are refused.
3. **Schema tests:** one manager per flat, bills need a split, duplicate TrxIDs rejected, ledger rows must fall inside their month, cross-flat references rejected.
4. **Isolation test:** a member of flat A gets nothing back from flat B's routes (Plan 3).
5. **Cron test:** running twice in the same window sends once (Plan 7).
6. Everything else: checked by hand on an Android phone and an iPhone.

## 9. Pilot success

3–5 real flats. Success: at least 3 flats close their **second** month in the app without the builder's help.
