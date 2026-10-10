# Collector PIN recovery (app team, pilot)

The collector forgot their PIN. There is no self-service recovery: the app team verifies who is asking, then sets a
one-time PIN with `scripts/reset-collector-pin.mts`. A flatmate who forgot their PIN doesn't need this: the collector resets
it on the Flat tab.

## Before the pilot: phone numbers at onboarding

Recovery is only as safe as the numbers it calls back. When a flat starts:

1. Ask every flatmate to save their own mobile number in the app (Home, Mobile number), and say why: it is how the app team
   checks it's really you if the collector's PIN ever needs a reset, and how flatmates reach each other. It stays optional;
   no SMS code is needed. A saved number is not yet a verified one.
2. Verify two of them yourself: call the collector's saved number and one other flatmate's saved number, and confirm each
   person's name and flat.
3. Record each one in the app-team log as a **verified number**: flat, name, number, date, and who called. A number saved
   in the app is only *saved*; it becomes *verified* only by this call, and only the log says which numbers are.

Any flatmate can change their own saved number later, and the app doesn't record it. So during a recovery the numbers in the
app are checked against the verified numbers in the log, never trusted on their own.

## Never

- Never ask for, or accept, the old PIN. Nobody can read it; it is stored only as a hash.
- Never reset because a chat message says "I'm the collector". A WhatsApp name or profile proves nothing.
- Never send the one-time PIN as a chat message.
- Never change the collector, money, meals or history to fix an access problem. The script changes only the PIN.
- If you can't verify both numbers, don't reset remotely: meet in person (step 4b), or wait.

## Not this procedure

- The collector has left the flat, lost the role, or can't be reached: that is a handover, not a PIN reset. The flat hands
  over in the app; if the collector can't, see `scripts/override-collector.mts`.
- The person asking is not the collector: the script refuses. Their PIN is reset by the collector in the app.

## Steps

1. **Request.** The collector writes to the published BashaBook WhatsApp (or email) with the flat's name and join code
   (every flatmate can see the code on the Flat tab). Note who asked, from which number, and when. If that number is not
   the collector's verified number, treat it as a warning: the checks below decide, not the message.

2. **Dry run.** It changes nothing and shows the flat, the collector's name, how many phones they are signed in on, the
   phone numbers saved in the app, and any handover offer still waiting:

   ```
   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/reset-collector-pin.mts <join code> "<collector name>" "<reason>" "<your name>"
   ```

   Check the first line says the production database (`ep-noisy-forest-…`), and that the name asking is the collector shown.

3. **Stop remote recovery and verify in person** (step 4b) if any of these is true:
   - the collector or the flatmate you'd call has no verified number in the log, or can't be reached on it;
   - a saved number in the app differs from its verified number in the log;
   - the person asking offers a new number to call;
   - the collector says they lost the phone or changed number;
   - the dry run shows the collector still signed in on a phone they say they don't have;
   - the dry run shows a handover offer the collector says they didn't make.

4. **Verify identity.**

   **a. Normal case: two calls, both needed; one never replaces the other.** Verified numbers only, never a number the
   person asking gives you.
   - **The collector:** call their verified number. They answer and confirm the flat, their name and the request.
   - **A flatmate you choose** (never one the person asking suggests): call their verified number. Ask them to read out
     the collector's number from their own phone's contacts; it must match the verified number. They confirm this person
     is their collector, still lives there, and asked for help.

   **b. In person.** Meet the collector with at least one flatmate there who confirms who they are. If a meeting isn't
   possible yet, wait: don't reset.

   No video call instead, by choice for the pilot: someone holding the lost phone can join a call too, and seeing faces
   proves little without something to match them against. If a pilot flat ever needs remote recovery, write a video
   procedure with a reliable check first, then allow it here.

5. **Reset.** Run the same command with `--apply` at the end. The reason says what you verified and how, without phone
   numbers, for example `forgot PIN; called collector and Tahsin on verified numbers`. The script prints the one-time PIN
   once.

   It signs the collector out on every phone, forces a new PIN at the next sign-in, and writes "PIN reset by the
   BashaBook team" in the flat's history (with your name and the reason stored, not shown). It checks that no month
   changed and says so. A `NO` can also mean a flatmate saved an entry at that same moment: look at the flat's history
   before anything else.

6. **Give the PIN by voice**: on a call to the collector's verified number, or in person.
   Never in chat. They sign in, choose a new PIN at once, and check that Home and Money show what they expect.

7. **A handover offer the collector didn't make**: the collector cancels it on the Flat tab as soon as they are signed in.

8. **Record it** in the app-team log: date and time, flat, who asked and from which number, how identity was verified,
   who ran the script, and the script's last line.

## Tested

Run on a disposable flat on the Neon test copy before relying on it: see the PR that added this file.
