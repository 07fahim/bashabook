# Mil: App Flow (V1)

## 1. Site map

```mermaid
flowchart TD
  L[Landing /] --> N[Create flat /new]
  L --> J[Join /j/:code]
  N --> S[Share join link]
  J --> P{Name claimed?}
  P -- no --> SP[Set PIN] --> H
  P -- yes --> EP[Enter PIN] --> H
  H[Home] --- M[Meals]
  H --- $[Money]
  H --- F[Flat]
  F --> MG[Manager panel]
  MG --> T[Today's texts]
  MG --> CP[Confirm payments / approvals]
  MG --> MB[Members]
  MG --> B[Bills]
  MG --> CM[Close month]
  MG --> ST[Settings]
  C[Cook link /c/:token] --> HC[Today + tomorrow headcount]
```

## 2. Create a flat (manager, ~3 min)

```mermaid
flowchart LR
  A[Flat name] --> B[Your name + PIN] --> C[Member names] --> D[Rooms + rent shares]
  D --> E[Meal weights, cutoff, fund on/off, bKash no.] --> F[Recurring bills] --> G[Share link via Messenger]
```
Every step after B can be skipped and finished later in Settings.

## 3. Join (member, ~20 s)

Tap the link in Messenger → see the names → tap mine → set a 4-digit PIN → Home, showing "Turn on reminders" and, on iPhone, the "Add to Home Screen" guide.

## 4. A normal day

```mermaid
sequenceDiagram
  participant Mem as Member
  participant App
  participant Cook
  participant Duty as Duty member
  Note over App: cutoff − 1h
  App->>Mem: Push "Meals lock at 10 pm — change tomorrow?"
  Mem->>App: Toggle lunch off / + guest
  Note over App: cutoff (22:00)
  App->>App: Tomorrow locked (clock based)
  App->>Cook: Push "Tomorrow: B 7 / L 8 / D 9"
  Note over App: 20:00 (day before duty)
  App->>Duty: Push "Your bazar turn tomorrow"
  Duty->>App: Log bazar ৳2,450 (paid by me / fund)
  App->>Mem: Meal rate + balances update live
```

## 5. Paying dues

Member → Money → Pay dues → sees the manager's bKash number and the amount owed → pays in the bKash app → enters the TrxID and amount → **pending** → manager confirms in the panel → balance updates. A duplicate TrxID is rejected.

## 6. Month close

```mermaid
flowchart TD
  A[1st of month: push 'Close last month'] --> B[Manager opens Close month]
  B --> C{Invariant OK? no pending items?}
  C -- no --> D[Shows entries to fix / approve] --> B
  C -- yes --> E[Preview settlement text]
  E --> F[Close: month locked]
  F --> G[Next month opens, recurring bills copied in]
  F --> H[Push dues reminders to members who owe]
  H --> I[+3 days: follow-up to anyone still unpaid]
```

## 7. Move-out

Manager → Members → Move out → pick the date → if this member is the manager, hand over the role first → the app shows their prorated final balance → the manager records a payout or deposit to settle it → the member stays visible in history and drops out of headcounts after the move-out date.

## 8. Strict mode differences

Any action marked "change request" in TRD §6 shows the member a "Sent to manager for approval" banner and goes into the manager's Approvals list. Nothing changes the numbers until it's approved.

## 9. Empty and error states

| Situation | What the user sees |
|---|---|
| No bazar yet this month | Meal rate shows "—" with "Add the first bazar" |
| Invariant fails | Red banner on Close month listing the entries involved |
| Session expired | PIN screen; returns to the same page afterwards |
| PIN locked | "Try again in N min or ask your manager" |
| Edit conflict | "Someone else changed this. Reload" |
| Push blocked | Reminders card explains how to allow notifications |
