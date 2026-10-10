# Collector PIN recovery (app team, pilot)

The collector forgot their PIN. There is no self-service recovery: the app team verifies who is asking, then sets a
one-time PIN with `scripts/reset-collector-pin.mts`. A flatmate who forgot their PIN doesn't need this: the collector resets
it on the Flat tab.

## Never

- Never ask for, or accept, the old PIN. Nobody can read it; it is stored only as a hash.
- Never reset because a chat message says "I'm the collector". A WhatsApp name or profile proves nothing.
- Never send the one-time PIN as a chat message. Tell it on a call.
- Never change the collector, money, meals or history to fix an access problem. The script changes only the PIN.
- If you can't verify, don't reset. Wait, and verify another way.

## Not this procedure

- The collector has left the flat, lost the role, or can't be reached: that is a handover, not a PIN reset. The flat hands
  over in the app; if the collector can't, see `scripts/override-collector.mts`.
- The person asking is not the collector: the script refuses. Their PIN is reset by the collector in the app.

## Steps

1. **Request.** The collector writes to the published BashaBook WhatsApp (or email) with the flat's name and join code
   (every flatmate can see the code on the Flat tab). Note who asked, from which number, and when.

2. **Dry run.** It changes nothing and shows the flat, the collector's name, and the phone numbers the flat saved in the app:

   ```
   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/reset-collector-pin.mts <join code> "<collector name>" "<reason>" "<your name>"
   ```

   Check the first line says the production database (`ep-noisy-forest-…`), and that the name asking is the collector shown.

3. **Verify identity: two independent checks, both needed.** Use only numbers saved in the app (shown by the dry run),
   never a number the person asking gives you.
   - **The collector:** call the collector's saved number. They answer, and confirm the flat, their name and the request.
   - **A flatmate:** call one other flatmate's saved number. They confirm this person is their collector, still lives
     there, and asked for help.

   **If the collector or every flatmate has no saved number**, or the collector lost the phone or changed number: do not
   reset from chat. Use another verified way instead: meet the collector in person with at least one flatmate there, or a
   video call with the collector and two flatmates you can recognise from an earlier verified contact (for example from
   setting the flat up). If none of that is possible, wait.

4. **Reset.** Run the same command with `--apply` at the end. The reason says what you verified and how, without phone
   numbers, for example `forgot PIN; called collector and Tahsin on saved numbers`. The script prints the one-time PIN once.

   It signs the collector out on every phone, forces a new PIN at the next sign-in, and writes "PIN reset by the
   BashaBook team" in the flat's history (with your name and the reason stored, not shown). It checks that no month
   changed and says so.

5. **Hand over the PIN on a call** to the collector's saved number. They sign in, choose a new PIN at once, and check that
   Home and Money show what they expect.

6. **Record it** in the app-team log: date and time, flat, who asked, how both checks were done, who ran the script, and
   the script's last line. If the money check said `NO`, stop and look before anything else.

## Tested

Run on a disposable flat on the Neon test copy before relying on it: see the PR that added this file.
