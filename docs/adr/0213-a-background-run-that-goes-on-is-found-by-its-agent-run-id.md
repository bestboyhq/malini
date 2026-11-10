# 0213 - A background run that goes on is found by its agent run id

Status: accepted

## Context

0122 has the runner finish an automation run at once when its turn ends over background commands, and it says the runner remembers that agent run in `#waitingRuns` "until the agent goes on or the run ends".
0168 renamed jobs to automations, so its `JobRunner` is `AutomationRunner` and its `#awaitsItsJob` is `#awaitsItsAutomation`.
0122 also says "waiting job runs" stay in memory and are forgotten "after a restart, which background commands do not survive either".
On main `#waitingRuns` was a `Map` from an agent run id to an automation run id, and two things read it: `#wentOn`, which puts a `succeeded` run back to `running` when its agent goes on, and `#awaitsItsAutomation`, which holds a queued Then, or any run the waiting run started.
`#wentOn` also deleted the entry, so the hold on a Then ended as soon as its parent was `running` again.
A restart of the automations platform emptied the map, so a run whose agent then went on stayed `succeeded` with its early summary, and a Then that waited for it started at once.
The state machine audit found that the runner's overlays "live in memory only; restart loses them. Same for the resurrection machine (`succeeded` to `running`)."
A Then that was waiting took the run's last result only through `startThen`, which handed the second `automations:run-finished` to `#followAgain`, so it depended on the event log hearing that event.
This record replaces two statements of 0122, that the runner remembers a waiting agent run in `#waitingRuns` and that waiting job runs stay in memory; the rest of 0122 stands.

## Decision

- **The agent run's row says whether it may go on.**
  `#waitingRuns` is gone, and the runner keeps no copy of the wait.
  `#mayGoOn` in `src/lib/automations/platform/automation-runner.service.ts` is true for a run that is `succeeded`, has a workstream and an `agentRunId`, and whose agent run is still open: `getWorkstreamRun(db, workstreamId, agentRunId)?.completedAt === null`.
  A turn that ends over background commands is not a terminal event, so the chat leaves that row open until the run ends.
- **A run that goes on is found by its ids.**
  `findAutomationRunOfAgentRun(db, sessionId, agentRunId)` in `src/lib/automations/platform/automation-runs.repository.ts` returns the newest automation run with that `session_id` and `agent_run_id`.
  `#wentOn` runs for every agent event that `resumesTurn` and sets the run found there back to `running`, with no `detail` and no `finishedAt`, only if it is still `succeeded` for that agent run.
- **The hold reads the same two facts.**
  `#awaitsItsAutomation` holds a queued Then while its parent is not `succeeded`, because a parent that went on is `running` again and its Then still waits for the end.
  It holds any queued run that has a parent while `#mayGoOn` is true for the parent and the parent's detail holds no turn report (`hasTurnReport`).
  What 0122 calls "the run has neither gone on nor ended" now means that the parent is `succeeded` and its agent run's row is open.
- **A run's end updates its Then.**
  `#finish` calls `#followAgain` for every run it finishes: a Then still pending takes the report as its context when the run succeeded, and is cancelled with `<title> went on and did not succeed.` when it did not.
  `startThen` only starts: it returns once a Then exists for the run (`childAutomationRun`), so the update no longer waits for the event log to hear a second `automations:run-finished`.

## Consequences

- A restart of the automations platform over the same database keeps the wait: a `succeeded` run whose agent goes on after the restart is `running` again and finishes with the end of that run, and its Then stays queued until the agent run's row closes.
- The app restarts the platform only at a launch, and a launch finds every agent run of the last process closed: in `src/main/modules.ts`, `registerChat` awaits `startAgentService`, which reaps the open ones with `reapOrphansOnStartup`, before `automations.start()`.
  A run that ended over background commands holds its reply in its open row.
  `completedOnceTurnEnded` in `src/lib/chat/platform/agent/runtime.ts` closes that row with the reply and no error when the bridge fails the run, including the cancel a quit sends, and `closingOf` in `src/lib/chat/platform/agent/lifecycle.ts` does the same for a crash, an exit and a lost bridge.
  A row closed that way carries no `PAUSED_FOR_EXIT_ERROR`, so `continuePausedRuns` does not continue the run under a new agent run id, and `apps/site/content/chat.md` says Malini does not resume it on the next start.
  At a launch `#mayGoOn` therefore reads a closed row, and a held Then starts with the early summary, as it did on main, where the map was empty at a launch.
  The database read changes that outcome only while the row is open, which a test reaches by restarting the platform over the same database.
  A run that is still `running` or `needs-you` is found by its session, and `#resumed` gives it the agent run id of its continuation.
- `#followAgain` runs in the same step as the finish, so a pending Then has the final report, or is cancelled, before any rule hears the second `automations:run-finished`.
- What must stay true: the runner keeps no memory of a waiting run, and whether an agent may still go on is read from the `succeeded` automation run and the open row of its agent run.
- Enforced by `src/lib/automations/platform/register.test.ts`, in 'an automation whose turn ends over background commands': 'runs again after a restart once you answer its agent and it goes on, and finishes with that end' and 'holds its Then across a restart while its agent may still go on', each with a new platform over the same database, 'finishes at once, runs again when its agent goes on, and finishes with the end of that run', "holds its Then while its agent may go on, then starts it once, with the run's last result", 'starts its Then at once when it ended with its report, and never twice', 'starts a held Then once the run ends without its agent going on' and 'cancels a held Then when the automation goes on and fails', and by `tests/e2e/automation-runs.spec.ts` ('an automation whose agent goes on after its background command runs again, holds its Then until it ends, and its edits commit under its own Commit line').
  No test starts the platform on a `succeeded` run whose agent run the chat closed at a launch, and the end-to-end test never restarts Malini.
