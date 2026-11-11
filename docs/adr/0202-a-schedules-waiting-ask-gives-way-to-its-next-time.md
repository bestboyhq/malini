# 0202 - A schedule's waiting ask gives way to its next time

Status: accepted

## Context

0075 says a due time is skipped while any run of the job is waiting, queued, running or needs you (0168 renamed jobs to automations).
0085 has the Schedules rule skip a time while the last run is unfinished.
A schedule in mode `ask` starts each run with `waitForYou`, and that run stays `waiting` until you answer.
A user who was away left the first ask unanswered, so every later time was skipped and the schedule never asked again.
0093 counts on the clock to log one Time reached for each due time, and on `triggeredBefore` to stop a replay of one event from starting a run twice.
The clock keeps the times it tried in memory only.
A quit after the log row of a time and before its run left that event unhandled, so the next launch handled it again while the clock logged the same time a second time, with a new id.
`triggeredBefore` could not tell the two events apart, and both could read no unfinished run before either run existed, so one time could start two runs.
This record replaces that sentence of 0075 and that clause of 0085 for a run that waits for your yes, and it adds to 0093; the rest of all three stands.

## Decision

- **A waiting ask that a schedule started gives way to the next time.**
  `startOnTime` in `apps/malini/src/lib/automations/platform/automation-schedules.service.ts` lists the unfinished runs of the automation with `listUnfinishedRunsOfAutomation`.
  `askedBefore` holds the ones that are `waiting` and have origin `schedule`.
  When every unfinished run is in `askedBefore`, the time goes on: `automations.run` starts the new run, and then `automations.cancel-run` cancels each run in `askedBefore`.
  A cancelled ask sends no notification, since `NOTIFIED_STATUSES` leaves out `cancelled`.
- **Any other unfinished run still skips the time.**
  A run that is queued, running or needs you, or that waits and did not start on a schedule, makes `startOnTime` log "skips a run on its schedule, its last run has not finished" and return.
- **The old ask is cancelled only after the new run started, and only while it still waits.**
  The cancel sits in the same `try` as `automations.run`, so a start that fails cancels nothing, logs "did not start on its schedule", and leaves the old ask waiting.
  `startOnTime` reads each ask again with `getAutomationRun` and cancels it only while its status is `waiting`, so a yes you give while the new time prepares keeps its run.
- **A time that a scheduled run already covers starts nothing.**
  `startOnTime` returns when `latestScheduledAutomationRun`, the newest run with origin `schedule`, was created at or after the due time.
  `check` makes the same comparison before it logs a time, and the handler needs it too, since a second event for one time has a new id that `triggeredBefore` does not know.
- **One automation handles its times in turn.**
  `handle` chains each Time reached of one `definitionId` after the one before it in `turns`, however that one ended, so the second event reads the run the first one created.
  A Time reached without a `definitionId`, such as the end of a Shipping wait or of a paused turn, returns at once.
- **The docs say it.**
  The On a schedule section of `apps/site/content/automations.md` lists the runs that skip a time (queued, still running, needs you) and says that a last run which still waits for your yes gives way to the new time.

## Consequences

- A schedule in mode `ask` keeps one live ask, for its newest time, and the older asks stay in the run list as `cancelled`.
- A yes you give while `placeTarget`, `updateFirst` and `automations.run` prepare the new time keeps its run, and the new run asks you again for that time.
- A cancel that fails is logged as a failed start, and the old ask waits until the next time cancels it.
- One start that never returns holds every later Time reached of its automation until Malini restarts, since each one waits in `turns` for the one before it.
- What must stay true: a waiting run that a schedule started never makes a later time skip, every other unfinished run still does, and one due time starts one scheduled run.
- Enforced by `src/lib/automations/platform/automation-schedules.service.test.ts` on real SQLite: "asks again for its next time while the last time still waits for your yes", "keeps the run you said yes to as its next time starts, and asks again for that time", "skips its time while the last run is unfinished, then runs again in its own workstream, merged with main" and "starts a time once when Malini closed after it logged that time and before the run began".
