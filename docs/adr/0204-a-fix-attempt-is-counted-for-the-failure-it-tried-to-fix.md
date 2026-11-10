# 0204 - A fix attempt is counted for the failure it tried to fix

Status: accepted

## Context

0085 and 0106 bound the Shipping rule's automations by **Fix attempts before asking you**, 0126 hands a failure that repeats after a re-run to Fix checks as attempt 1, 0180 stops Address review when its attempts run out, and 0198 gives back the attempt of a run that Malini cut short, but no record says how an attempt is counted.
On main `workstream_ship` kept one `attempts` next to one `failure_signature`, and a different signature set the count back to 1, so a build whose `test` and `lint` checks failed in turn never reached the limit; the state machine audit named it: "3 automations share it; one rewrite can rewind counts".
The limit came from two places, the setting `merge-queue.fix-attempts` once a merge was queued and the default 3 while the ship was `local` or `draft`, so the audit also found "setting and default 3 disagree", and Shipping parsed a stored `2.6` with `parseInt` as 2 where Settings rounds it to 3.
Clicking Merge while Address review ran cleared the signature that run was working on, so `settleActiveAutomation` could not record which change requests it had addressed.
This record adds to 0085, 0106, 0126, 0180 and 0198; the rest of each stands.

## Decision

- **An attempt is counted for the failure it tried.**
  `workstream_ship.fix_attempts` is a JSON object from a failure signature to the attempts spent on it, and `FixAttempts` in `src/lib/pull-requests/domain/shipping.ts` is its `ReadonlyMap<string, number>`.
  The signatures are `checks:[...]` for failing checks, `conflicts:[...]` for conflicted paths and `review:{...}` for change requests and threads, and Fix checks, Resolve conflicts and Address review share the one map and the one limit.
  `fixAutomation` and `reviewToStart` read `spent`, the count under the signature, and start attempt `spent + 1` until `spent` reaches the limit.
  A failure that comes back after another one continues its own count.
  The stop reads `<label> did not work. Malini tried once.` or `Malini tried N times.`, with N the count under the signature it gave up on.
- **The attempt is written under the signature it tried.**
  `fixAttemptSpent` in `src/lib/pull-requests/platform/ship-store.ts` sets `failureSignature`, puts the attempt under it in the map and clears the re-run marker, and `startAutomation` in `src/lib/pull-requests/platform/ship-moves.ts` and `startReview` in `src/lib/pull-requests/platform/ship-rule.ts` both use it.
  A `fix-gave-up` stop carries the `signature` it gave up on, and `apply` stores it as `failureSignature`, so a stopped merge names the checks and the count it gave up on even when another failure came between.
  `ShipRow.attempts` is derived from the map: the count under the current `failure_signature`, or 0 with none.
- **A run that Malini cut short gives back one attempt of its signature.**
  `settleActiveAutomation` in `ship-rule.ts` calls `refundedFixAttempt` for a run that `automationRunInterrupted` marks (0198), which lowers the count under the current `failureSignature` by one and never below 0.
- **A new queue starts from zero unless a run is open.**
  `retry` and `cancel` in `src/lib/pull-requests/platform/ship-intents.ts` clear `fixAttempts` and `failureSignature`.
  `queueMerge` clears them only when the ship has no `activeAutomationRunId`: a Merge click during an Address review must keep the signature that review is working on, because `settleActiveAutomation` reads it to record which change requests the run addressed.
- **One limit reads the setting in every phase.**
  `fixAttemptLimit` in `ship-rule.ts` reads `MERGE_QUEUE_FIX_ATTEMPTS_SETTING` whatever the phase, and the default 3 for a `local` or `draft` ship is gone.
  `clampedFixAttempts(value)` in `shipping.ts` reads it the way `automationsMaxConcurrent` reads its setting: `Number`, `DEFAULT_MERGE_QUEUE_FIX_ATTEMPTS` for a blank or non-finite value, then `Math.round` and `MERGE_QUEUE_FIX_ATTEMPTS_RANGE`, 1 to 20.
  `clampAutomationSetting` in `src/lib/app/domain/automation-settings.ts` calls it for this setting and `automationsMaxConcurrent` for the other, so Settings and the main process cannot round one value two ways.
- **The migration adds a column and keeps the old one.**
  A migration in `src/main/db/migrations.ts` adds `fix_attempts TEXT NOT NULL DEFAULT '{}'` and backfills it with `json_object(failure_signature, attempts)` for each row that has a signature and more than 0 attempts.
  It also clears `checks_rerun_at` and `checks_rerun_head_sha` on those rows, because the old `checksRerunOf` ignored a marker once attempts were above 0 and the new one does not look at attempts.
  The `attempts` column stays, and nothing reads or writes it.

## Consequences

- A failure that comes back after another one continues its count, so test, lint, test ends at the limit instead of looping, and each different failure still gets the whole limit.
- The attempts one ship can spend are bounded by the number of different failures times the limit, not by the limit alone.
- The limit you set in **Fix attempts before asking you** now reaches Address review on a draft, which used the default 3 before.
- A rollback still opens the table because `attempts` stays, but an older build reads and writes only `attempts` and `failure_signature`.
  After a downgrade and an upgrade, `fix_attempts` misses what the older build spent and the older build misses what this one spent, and nothing reconciles them.
- A re-run that GitHub refuses still starts Fix checks as attempt 1: `fixChecksAutomation` in `ship-moves.ts` hard-codes `attempt: 1`, so for a failure that has already spent its attempts the run starts past the limit and sets that count back to 1; this is open.
- What must stay true: an attempt is written under the signature it tried and read back from that signature alone, only `retry`, `cancel` and a `queueMerge` that finds no open run clear the counts, and one limit from the setting applies in every phase.
- Enforced by `src/lib/pull-requests/domain/shipping.test.ts` ("counts attempts per failure signature and gives up after the limit", "starts a review fix only for open change requests not yet addressed, within the attempts", "clamps the fix attempt setting to 1-20 the way Settings rounds it, defaulting when unset"), `src/lib/pull-requests/platform/ship-rule.test.ts` on real SQLite and a fake `gh` ("gives up after the configured attempts on the same failure", "spends the attempts on a failure once, even when another failure came between", "spends no fix attempt on an automation Malini interrupted when it closed", "records the review an Address review addressed when you click Merge while it runs", "stops addressing a review in a draft after the fix attempts you set"), `src/main/db/migrations.test.ts` ("counts the fix attempts a merge spent per failure and keeps the old count for older builds"), `src/lib/app/domain/automation-settings.test.ts` ("clamp to whole numbers inside each range") and `tests/e2e/merge-queue.spec.ts` ("Fix checks gets the attempts you set for each failing check, then needs you").
  The e2e also passes on the old rule that a new failure resets the count, so it holds the setting and the stop message end to end, and the per-signature rule rests on the `shipping.test.ts` and `ship-rule.test.ts` tests above.
