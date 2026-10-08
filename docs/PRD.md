# Mil: Product Requirements Document (V1)

Date: 2026-10-09 · Status: Draft · Design record: `docs/superpowers/specs/2026-10-09-mil-v1-design.md`

## 1. Problem

In a Bangladeshi bachelor flat (mess) of 8–10 people, one member, the manager, keeps the accounts by hand in a notebook, Excel or the Messenger chat. Every day they count meals for the cook. They chase whoever's turn it is for bazar, collect deposits, split rent, utilities, the cook's salary and laundry, and at month-end work out who owes whom. This is unpaid, it takes time, and it causes arguments. The arguments get worse when flatmates are strangers.

## 2. Product

**Mil (মিল)**, the app that runs your shared flat. It's a mobile web app (PWA), joined by a link shared in the flat's Messenger group.

**Promise:** everyone in the flat knows what they ate, what they paid and what they owe, and nobody has to do the maths.

## 3. Users

| User | Needs | Pain today |
|---|---|---|
| **Manager** (member with the manager role; may rotate monthly) | Less daily work, no arguments, money collected | Counting, chasing, calculating, being the "bad guy" |
| **Member** (friend or stranger) | Change meals easily, trust the numbers, know their dues | Has to ask the manager, can't check the maths |
| **Cook** (cooks and washes clothes only) | Know how many to cook for | Last-minute changes, wrong counts |

**Initial target customer:** flats of 8–10 residents in Dhaka (expand to 6–12 if the data supports it) with a hired cook, where bazar duty rotates among members.

## 4. Goals and success metrics

| Goal | Metric | V1 target |
|---|---|---|
| Flats keep using it | Flats closing their 2nd month in the app without help | ≥ 3 of 5 pilot flats |
| Members take part | Meal changes made by members themselves, not the manager | ≥ 70% |
| Cook gets the count on time | Headcount sent by cutoff + 5 min | ≥ 95% of days |
| Trusted numbers | Months where the manager's cash count matched the app's fund on the first try | ≥ 80% |
| Willing to pay | Pilot managers saying yes to ৳199/month | ≥ 2 of 5 |

## 5. V1 requirements

Priority: **P0** = V1 can't launch without it, **P1** = in V1 but can slip.

### Flat setup and access
- **P0** Manager creates a flat: name, members, rooms with rent shares, meal weights (default B 0.5 / L 1 / D 1), cutoff time (default 22:00), bKash number, recurring bills. The fund (cash the manager holds) always exists; members can also pay out of pocket.
- **P0** Join by link: tap your name, set a 4-digit PIN, stay logged in for 90 days.
- **P0** Hand over the manager role to another member.
- **P1** Bangla/English switch per member.

### Meals and cook
- **P0** Each member has default meals (B/L/D); they only record changes. Changes for tomorrow lock at the cutoff.
- **P0** Away from/to dates; guest meals added to the host.
- **P0** Headcount for the cook (today and tomorrow) on the manager's screen, with Copy and Share.
- **P1** Read-only cook link with push notifications.

### Bazar
- **P0** Bazar rotation generated from an order the manager sets; the manager can reassign a day.
- **P0** Any member logs bazar: amount, note, paid by me or from the fund.
- **P1** Push reminder to the person on duty the evening before.

### Bills and money
- **P0** Recurring bills copied in each month; one-off bills.
- **P0** Split rules: equal (prorated by days), by meals, by room, selected members (e.g. laundry).
- **P0** Deposits; dues paid via bKash TrxID, pending until the manager confirms.
- **P0** Live meal rate, every member's balance, and the full ledger, visible to everyone.

### Month-end
- **P0** Close month: checklist (no pending items, no problems, cash count matches) → settlement text → lock → open the next month with balances carried forward.
- **P0** Closed months are frozen: shown from a saved snapshot, never recalculated.
- **P0** Move-out: prorated costs; the leaver's balance becomes final at month close and is settled then.
- **P0** Change log; edits to a closed month need manager approval.

### Trust and automation
- **P0** Strictness setting: relaxed (friends) or strict (strangers). See TRD §6.
- **P1** Web Push: meal reminder 1 hour before cutoff, headcount at cutoff, bazar duty the evening before, dues reminders.

## 6. Out of scope (V1)

Personal accounts that move between flats, phone or SMS login, SMS, native apps, duty swap requests, a fund on/off switch, chores, inventory, receipt photo scanning, analytics, a menu or feedback system, a marketplace, payment-gateway integration (the app never holds money).

## 7. Assumptions to test

1. Managers will switch from their notebook, Excel or Messenger chat.
2. Members will record meal changes without being chased.
3. Flats will pay ~৳199/month when free apps exist.
4. Web Push is reliable enough; iPhone users will add the app to their Home Screen.

## 8. Release

Pilot with 3–5 flats for 2 full months → interviews → decide on pricing and the V2 scope.
