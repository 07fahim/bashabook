# Collector PIN recovery (app team, pilot)

The collector forgot their PIN, or their sign-in is locked. There is no self-service recovery: the app team verifies who is
asking, then sets a one-time PIN with `scripts/reset-collector-pin.mts`. A flatmate who forgot their PIN doesn't need this:
the collector resets it on the Flat tab.

## Locks (policy of 2026-10-12)

Wrong PIN tries 5, 10, 15 and 20 lock the sign-in for a while (15 minutes, doubling). From the 20th on, every wrong try
says how many are left. The 25th locks it for good and says so at once. Each permanent lock shows in the flat's history
("locked after 25 wrong PINs") and the Flat tab shows a Locked badge. Nothing else changes: money, meals, roles and
history stay as they were.

Unlocking a flatmate (policy of 2026-10-13): any flatmate living there clears the lock from Home (a notice card, "Clear the
lock", shown while someone is locked). The PIN stays, so this can't take an account over; after a permanent lock 4 more
wrong tries are allowed and the 5th locks it for good again (count set to 20), so each clear hands out at most 5 guesses,
not 25. One clear per helper per person between that person's PIN resets: Zarif can clear Tahsin once; after that only
another flatmate can, until Tahsin's PIN is reset. So one helper can't top up the same person's guesses, and a whole flat
colluding gets about 5 guesses per helper per reset. The history says who cleared whom ("cleared the lock · PIN
unchanged"); a run of them for one person is the thing to look into (below). A clear never touches money, meals, roles or
months. The collector's PIN reset also still unlocks. Nobody can clear their own lock, and nobody can clear the
collector's: that is this procedure, only (a timed lock on the collector opens by itself).

Watch per flat and month, from the history: permanent locks, and clears. More than two locks the locked people say they
didn't cause, or more than three clears for one person: look into it (it may be someone guessing with a cleared lock).
Those are triggers to investigate, not proof of an attack. Tell every pilot flat at onboarding how a clear works.

Anyone holding the flat's join link can run up a member's wrong tries. If locks appear that nobody in the flat caused, the
collector makes a new join code (Flat tab, Join link): the old link stops working at once, everyone signed in stays signed
in. A new code does not unlock anyone; the locked people still need a reset.

## Before the pilot: phone numbers at onboarding

Recovery is only as safe as the numbers it calls back. When a flat starts:

1. Ask every flatmate to save their own mobile number in the app (Home, Mobile number), and say why: it is how the app team
   checks it's really you if the collector's PIN ever needs a reset, and how flatmates reach each other. It stays optional;
   no SMS code is needed. A saved number is not yet a verified one.
2. Verify three of them yourself: call the collector's saved number and two other flatmates' saved numbers, and confirm
   each person's name and flat. Two flatmates, not one: if the collector ever loses their phone, recovery leans on both.
3. Record each one in the app-team log as a **verified number**: flat, name, number, date, and who called. A number saved
   in the app is only *saved*; it becomes *verified* only by this call, and only the log says which numbers are.

Any flatmate can change their own saved number later, and the app doesn't record it. So during a recovery the numbers in the
app are checked against the verified numbers in the log, never trusted on their own.

Why numbers and not faces: the app team doesn't know anyone's face, so meeting someone or seeing them on video proves
nothing by itself. What proves identity is a flatmate reached on their own verified number, whose phone wasn't lost.

## Lost flat code

Someone signed out and lost the flat code. First ask them to check with anyone in the flat: every signed-in person sees the
code on Home (and the phone they used shows Back to the flat on the landing page). Only when nobody can:

1. Ask the flat's name and the collector's name. Run (read-only)
   `node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/find-flat.mts "<flat name part>" "<collector name part>"`.
2. Verify before telling the code: call back a saved number the script prints (the asker's own or the collector's) and
   tell the code by voice on that call. Never a number the person gives you now. Knowing names is never enough: with the
   code anyone gets 25 PIN guesses per name and can lock everyone out, and anyone with the code can claim a name the
   script marks not joined yet and set its PIN.
3. No saved number to call: a flatmate who is signed in passes the code on in person (they see it on Home under Sign out).
4. No saved number and nobody else in the flat has joined: the team can't tell who is asking, so don't tell the code. They
   start a new flat with Create a flat. An empty trial flat (at most one person joined, no money entries, no meal changes,
   no history for 30 days) is removed on its own after a month. Suggest they save a mobile number on Home (My account) in
   the new flat so a call-back works next time.
5. They forgot the PIN too: a flatmate's PIN is reset by the collector on the Flat tab; the collector's PIN follows Steps
   below.

## Never

- Never ask for, or accept, the old PIN. Nobody can read it; it is stored only as a hash.
- Never reset because a chat message says "I'm the collector". A WhatsApp name or profile proves nothing.
- Never send the one-time PIN as a chat message.
- Never change the collector, money, meals or history to fix an access problem. The script changes only the PIN.
- If the checks in step 4 can't be completed, don't reset. Wait.

## Not this procedure

- The collector has left the flat, lost the role, or can't take part at all (away, unreachable by any means; a lost phone
  alone is step 4b): that is a handover, not a PIN reset. The flat hands
  over in the app; if the collector can't, see `scripts/override-collector.mts`.
- The person asking is not the collector: the script refuses. Their PIN is reset by the collector in the app.

## Steps

1. **Request.** The collector writes to the published BashaBook WhatsApp (or email) with the flat's name and join code
   (every flatmate can see the code on Home under Sign out). Note who asked, from which number, and when. If that number is not
   the collector's verified number, treat it as a warning: the checks below decide, not the message.

2. **Dry run.** It changes nothing and shows the flat, the collector's name, how many phones they are signed in on, the
   phone numbers saved in the app, and any handover offer still waiting:

   ```
   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/reset-collector-pin.mts <join code> "<collector name>" "<reason>" "<your name>"
   ```

   Check the first line shows the production user name `postgres.ccmueosbxifibfbigowg` and that the name asking is the
   collector shown.

3. **Choose the check.** Use 4a only if none of these is true; if any is, use 4b:
   - the collector has no verified number in the log, can't be reached on it, or its saved number in the app differs;
   - the collector says they lost the phone or changed number, or the person asking offers a new number to call;
   - the dry run shows the collector still signed in on a phone they say they don't have;
   - the dry run shows a handover offer the collector says they didn't make.

   If the flat has fewer verified flatmates than the check needs (one for 4a, two for 4b), or they can't be reached on
   their verified numbers: no reset yet. Verify flatmates first, as at onboarding, then come back here.

4. **Verify identity.**

   **a. Normal case: two calls, both needed; one never replaces the other.** Verified numbers only, never a number the
   person asking gives you.
   - **The collector:** call their verified number. They answer and confirm the flat, their name and the request.
   - **A flatmate you choose** (never one the person asking suggests): call their verified number. Ask them to read out
     the collector's number from their own phone's contacts; it must match the verified number. They confirm this person
     is their collector, still lives there, and asked for help.

   **b. The collector's number can't be trusted: two flatmates vouch, both needed.** Whoever holds a lost phone answers
   its number, so the collector's number counts for nothing here. You choose both flatmates, never the person asking.
   - **Flatmate A, on video:** A video-calls you **from A's verified number** (call A first on that number and ask them
     to), with the collector sitting next to A. A confirms on camera this is their collector, who still lives there and
     asked for help.
   - **Flatmate B, on a separate call:** call B on **B's verified number**. B confirms the collector is with A now and
     asked for help.
   - Meeting the collector in person with flatmate A there counts the same as A's video call; flatmate B's separate call
     is still needed.
   - If the collector has a new number, verify it during A's call (call it; the collector answers next to A) and update
     the log, so the next recovery doesn't fall back to 4b.

5. **Reset.** Run the same command with `--apply` at the end. The reason says what you verified and how, without phone
   numbers, for example `forgot PIN; called collector and Tahsin on verified numbers`. The script prints the one-time PIN
   once.

   It signs the collector out on every phone, forces a new PIN at the next sign-in, and writes "PIN reset by the
   BashaBook team" in the flat's history (with your name and the reason stored, not shown). It checks that no month
   changed and says so. A `NO` can also mean a flatmate saved an entry at that same moment: look at the flat's history
   before anything else.

6. **Give the PIN by voice**: on a call to the collector's verified number (4a), or on flatmate A's call or in person (4b).
   Never in chat. They sign in, choose a new PIN at once, and check that Home and Money show what they expect.

7. **A handover offer the collector didn't make**: the collector cancels it on the Flat tab as soon as they are signed in.

8. **Record it** in the app-team log: date and time, flat, who asked and from which number, how identity was verified,
   who ran the script, and the script's last line.

## Tested

Run on a disposable flat on the TEST Supabase project (bashabook-test) before relying on it: see the PR that added this file.
