# 0247 - A draft watches its checks and Fix checks fixes them

Status: accepted

## Context

0086 lets the GitHub reader read a pull request only while shipping waits on GitHub, and a draft never waited, so after Open draft nothing read its checks until a person looked.
0126 re-runs failed GitHub Actions jobs once before Fix checks, and 0206 caps fix attempts per failure, but both ran only inside a queued merge.
0180 put Address review on its own trigger and let Shipping adopt its run on a draft without merging; failing checks on a draft had no such path.
0246 lets an agent push to its open draft unasked, so a workstream can go from prompt to green checks, but only when something reports the checks back.
In the "Intel Mac" workstream (draft #203) the Windows and Linux jobs ran only on GitHub, and their failures sat unread until the user asked.
Waking the Open draft chat for every succeeded push gave the agent nothing new: the push is not the news, the checks are.

## Decision

- **The draft watch.** After Malini pushes to a draft, or a failing-checks trigger event arrives for one, the ship row sets `workstream_ship.checks_watched_since` (migration in `src/main/db/migrations.ts`), and `checksWatchMove` (`src/lib/pull-requests/domain/shipping.ts`) waits on the checks with the steps `waiting-for-checks` and `rerunning-checks`.
- `pullRequestReadEvery` reads the draft every `checksPollMs`, 45 seconds, during those steps.
- The reader (`openPullRequestStatus` in `register.ts`) already reads checks as pending while GitHub's `headSha` lags the pushed head, and while a head with a `.github/workflows` file that names `pull_request` has no checks yet, for `CHECKS_START_GRACE_MS`, 5 minutes, so the watch does not end before the pushed head's checks start.
- The watch stops when the checks settle, the branch is no longer pushed as it is (`ahead > 0` or no upstream), the pull request leaves `draft`, or `CHECKS_WATCH_MS`, 60 minutes from the latest push or trigger event, runs out; a stop clears `checks_watched_since`.
- **Fix checks on drafts by default.** The **Fix checks** builtin seeds the trigger `on pull-requests:pull-request-changed where state is draft and checks is failed`, mode `auto` (`builtin-automations.ts`), and is a **Fix failing checks on drafts** switch in Settings, Automations (`automation-defaults.ts`); an install from before gets it only where `builtin = 'fix-checks' AND trigger_when IS NULL`, so a trigger the user set stays.
- While that trigger is on its own, `triggered` returns true for it and Shipping owns the fix: the failing draft re-runs failed Actions jobs once per failure signature (0126), then runs **Fix checks**, commits and pushes its fix, and watches again, within `fixAttemptLimit` (**Fix attempts before asking you**, default 3) per signature (0206).
- It acts on `failingChecks`, the trigger's own `checks is failed`, and fixes `blockingChecks`; `gh` reports `required` as null, so on a draft that is every failing check that ran, and a check that never started is left to the user.
- It never fixes while a chat in the workstream works, never marks the draft ready and never merges.
- In **Ask me first** the trigger starts a plain run once the user allows it, and Shipping pushes what it changed like any run in a draft; with the trigger off, failing checks on a draft wait for **Merge**.
- A trigger on a draft Malini does not ship does nothing.
- **The cap wakes the chat.** At the cap the draft keeps phase `draft` with `needsYou` `fix-gave-up`, the top bar shows **Fix gave up**, and `chat.deliver({ kind: 'report' })` wakes the `chatSessionId` of the workstream's latest **Open draft** run once, with the failing check names, their links and the head (`draftChecksGaveUpReport` in `pull-request-fix-prompt.ts`).
- **A succeeded Open draft wakes no chat.** `#automationRunSituation` (`reconciler.service.ts`) returns null for it, and a failed Open draft still wakes the chat that started it; the checks the watch reads and the cap's report are the signal.

## Consequences

- A draft goes from a push to green checks without a prompt, and a failure comes back to the chat that opened it only once Malini stopped fixing it.
- A draft costs GitHub one read every 45 seconds for at most an hour after each push, and nothing once its checks settle.
- The top bar follows the watch: each `pull-requests:pull-request-changed` the renderer hears updates the sidebar's pull request state, and for the open workstream re-reads the pull request at once (`acceptPullRequestReadCommand`, `refreshActivePullRequestCommand`), so it shows a new check state one read after Malini sees it, not on the top bar's own 10 to 30 second cadence.
- That costs one more read when the change came from a read the renderer made itself.
- Fix checks now takes a Then like Address review.
- Enforced by `shipping.test.ts`, `ship-rule.test.ts` ("a draft's checks"), `reconciler.service.test.ts`, `migrations.test.ts` ("turns on Fix checks for failing drafts, keeping a trigger you set"), `register.test.ts` and `tests/e2e/draft-fix-checks.spec.ts`, whose "the top bar shows the checks Malini reads on a draft before it reads them itself" fails when the top bar waits for its own read.
- This adds to 0086, 0126 and 0180.
