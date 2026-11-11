# 0203 - A rule that fails hands its event back, and an alarm rings once

Status: accepted

## Context

0085 says each rule settles on its own, so a rule that throws is logged and the others and the model still run, and 0091 says the log names that rule.
0085 also says an event is marked handled once the reconciler is done with it, and that the unhandled events of the last hour are handled again at boot.
0086 has the clock check alarms every second and fire each due one as Time reached, and 0106 keeps those alarms.
0093 makes a replayed event start its runs once, by the id it keeps in the log.
Those records say jobs, and 0168 renamed them automations.
Four gaps remained in that wording.
`Reconciler.#apply` caught the error of a rule and returned `false`, so `handle` returned, `handleAndMark` marked the event handled, and no replay handed it back: a rule that met a busy database lost its event.
`takeDueAlarms` deleted every due alarm before `ring` emitted it, so a crash between that delete and the log row of the Time reached lost the wait for good.
At boot the event log replayed events to the rules while `AutomationRunner.#recover` was still settling the runs the last process left behind, so a rule could read a run as running that nothing ran any more.
The model queue named a finished run by its id, and a conflict decision took the subject of the automation run that caused its event, so a newer question about the same work did not always replace the older one.
This record adds to 0085, 0086 and 0091; the rest of them stands.

## Decision

- **A rule that fails hands its event back.**
  `Reconciler.handle` in `apps/malini/src/lib/automations/platform/reconciler.service.ts` runs each rule that hears the event.
  It logs `the <rule> rule could not handle <channel>` for each rule that throws, and the other rules and the model step still run.
  Then it throws `the <rules> rule failed`, with the name of every rule that failed.
- **A failed event stays unmarked, and the next start hands it over again.**
  `handleAndMark` in `apps/malini/src/lib/automations/platform/event-log.service.ts` logs `could not handle <channel>` and returns without `markEventHandled`.
  `replay` runs once at every start and hands over the unhandled events newer than `REPLAY_WINDOW_MS`, one hour.
  `dispatch` tracks each `handleAndMark` in `BackgroundWork` (0204).
- **Every rule and the model step wait for the runs of the last process to settle.**
  The handler that `registerAutomations` in `apps/malini/src/lib/automations/platform/register.ts` gives the event log awaits `runner.recovered()` before it calls `reconciler.handle`.
  `AutomationRunner.recovered()` resolves when `#recover`, which `runner.start()` begins, has finished, whether it threw or not.
  `#recover` settles each run the last process left running or needing you, and cancels the runs of a closed workstream.
- **An alarm rings once, and leaves its table after its Time reached is in the log.**
  `ring` in `apps/malini/src/lib/automations/platform/automation-schedules.service.ts` reads the due alarms with `listDueAlarms`, which deletes nothing.
  For each alarm it emits the Time reached unless `loggedSince` finds that payload in `event_log` at or after the alarm's `dueAt`, and then `takeAlarm` deletes the row.
  All three sit in one `try`: an error in any of them is logged, and the alarm stays for the next `ring`, a second later.
  The event log writes its row inside `emit`, so a crash between the two statements leaves an alarm whose event is already logged, and the next `ring` takes it without a second event.
- **One name for the subject of a queued event and of an asking decision.**
  `runSubject` and `conflictSubject` in `reconciler.service.ts` build `automation:<definition>:<workstream>` and `conflict:<workstream>`.
  `subjectKey` and `#subject` call both, and `#answerWithRun` calls `runSubject`.
  Before, the queue named a finished run by its id, and a conflict decision took the subject of the automation run that caused its event, so a newer question about the same conflicts did not replace the older one when their causes differed.

## Consequences

- A rule that fails on a busy database loses nothing while the event is young: the event stays in the log, and the next start handles it again.
  The retry happens only at a start, and only for events from the last hour, so an event whose failure no start follows within the hour stays unhandled until the log prunes it after a week.
- The rules that handled the event hear it again.
  Triggers, Thens, schedules and compatibility checks start once per event (0093), and the model step skips an event that already has a decision.
  Deliveries has no such guard: `ChatDeliveries.deliver` in `apps/malini/src/lib/chat/platform/deliveries.service.ts` inserts a new row on every hearing, so a report can reach the starter chat twice after a replay; this is open.
- Only an error that leaves a rule's promise hands its event back.
  Shipping's `#shipOnce` and the model step's `#drain` still log their errors and go on, so a failed decision there marks the event handled.
- Events wait for `#recover`, which reads the chat of each run it settles in turn, so a slow read delays every event at boot.
- A newer question about the same conflicts replaces the older one whatever caused each, and the queue keeps only the newest of two finished runs of one automation in one workstream, as 0085 says of a subject.
- What must stay true: an error that leaves a rule keeps its event unmarked, no rule hears an event before `runner.recovered()` resolves, and an alarm leaves its table only after its Time reached is in the log.
- Enforced by `src/lib/automations/platform/event-log.service.test.ts` on real SQLite ("leaves an event a rule could not handle for the next start, which hands it over again", "hands the events Malini had not finished handling to the triggers again when it starts" and "takes a due alarm only once its Time reached is in the log, and rings it once across a restart"), `src/lib/automations/platform/register.test.ts` ("settles the runs it left behind before a rule reads them"), `src/lib/automations/platform/reconciler.service.test.ts` ("about conflicts an automation ran into gives way to a newer question about conflicts there") and `src/lib/automations/platform/automation-schedules.service.test.ts` ("runs the time it missed while Malini was closed once it settles the run that closing cut" and "keeps a due alarm while the log cannot be read, and rings it once the log can").
  No test queues two finished runs of one automation in one workstream, and none replays an event that Deliveries already handled.
