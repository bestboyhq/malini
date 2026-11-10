# 0204 - The automations platform finishes its background work before the database closes

Status: accepted

## Context

0207 gives the order of `Modules.shutdown()` at quit, which includes waiting for automations to settle, and says `call()`, the way the main process runs its own commands from automations, stays ungated and untracked, so `CommandRegistry.close()` never waits for what automations started with it.
It does not say what settling is, and on main nothing could be waited for.
The runner's scheduling pass, recovery and dispatches, the reconciler's drain, wakes and notices, the event log's handlers, an experiment's replays and the ask noticed after a merge all started as fire and forget: `void`, a bare `.catch`, or a promise kept in a private field that nothing awaited.
`automations.dispose()` stopped timers and subscriptions and returned.
After `chat.stop()`, `Modules.shutdown()` waited only for the base-overlap watch, which has its own wait of 5 seconds (`OVERLAPS_SETTLE_BUDGET_MS` in `src/main/modules.ts`), and nothing waited for the automations platform.
Work in flight at quit could therefore still be writing when `quit()` closed the database.
The event log's test for a stop in flight slept 20 milliseconds and hoped the handler was done.
This record adds to 0207; the rest of 0207 stands.

## Decision

- **One set tracks the work.**
  `BackgroundWork` in `src/lib/automations/platform/background-work.ts` holds every promise handed to `add()` until it settles and logs a rejection as `automations: <error>`, so a failure never goes unhandled.
  `settled()` returns once no promise is left, including promises added while it waits.
  It is a class of the automations platform, not the `BackgroundWork` type of the chat domain, which describes the background tasks of an agent run.
- **Every start goes through it.**
  `registerAutomations` builds one `BackgroundWork` and hands it to the runner (the scheduling pass, recovery and each dispatch), the reconciler (the drain, each wake and each notice), the event log (each handler), the experiments (each replay) and the ask noticed after a merge.
- **`AutomationsPlatform.settled()` waits for it, for at most 5 seconds.**
  `src/lib/automations/platform/register.ts` races `work.settled()` against `delay(SETTLE_BUDGET_MS, 'late', { ref: false })`, so the timer never keeps the process alive.
  When the budget wins, it logs `automations: Malini closed before its work finished` and returns.
  A `ponytail:` comment names the ceiling: work past the budget meets a closed database.
- **`Modules.shutdown()` waits after the chat stopped.**
  The order in `src/main/modules.ts` is `stats.stop()`, `extensions.stop()` and `app.streaming.stop()`, then `pullRequests.dispose()`, `automations.dispose()`, `brain.dispose()`, `repositories.watchers.dispose()`, `repositories.overlaps.dispose()`, whose promise it keeps as `overlapsSettled`, and `cancelGitHubSignIn()`.
  It then awaits `repositories.installs.abortAll()`, calls `providers.stop()`, awaits `chat.stop()`, awaits `automations.settled()`, and awaits `overlapsSettled` in a race against `OVERLAPS_SETTLE_BUDGET_MS` (5 seconds).
  The lid hold, the confirmed shutdown, usage data and the window state follow, and `quit()` in `src/main/index.ts` closes the commands and the database last.
  `dispose()` comes first, so no event starts new work and `settled()` waits for what already runs.
  `settled()` comes after `chat.stop()` because that work calls chat commands through `call()`, which no one else tracks (0207).
  Once the chat stopped, `ensureReady()` in `src/lib/chat/platform/agent/runtime.ts` refuses a call that reaches it with `because Malini is closing`, and the runner records the run that call cut short as interrupted (0200), inside the wait.
- **Installs stop before the chat does.**
  `InstallRegistry.abortAll()` in `src/lib/shared/repositories/platform/provisioning.service.ts` aborts every dependency install in flight with `abortAndWait`: `SIGTERM` to its process group, `SIGKILL` after `ABORT_GRACE_MS` (2 seconds), and a log line and no more waiting once `ABORT_DEADLINE_MS` (30 seconds) has passed.
  A process group that refuses a signal gets the same log line and no more waiting, so the steps after it still run.

## Consequences

- `Modules.shutdown()` can take up to 5 seconds longer for automations work, and up to 30 seconds for an install that does not exit.
- Work that outlives the budget meets a closed database, and the platform logs `automations: Malini closed before its work finished`.
  The runner recovers a run left unfinished at the next launch.
- The wait covers `BackgroundWork` only.
  `runner.close(workstreamId)` on `repositories:workstream-removed` in `register.ts` and `notify(run)` for a scheduled run in `automation-schedules.service.ts` still start with `void`, and quit does not wait for them.
- An event the platform was still handling at `dispose()` stays unhandled, because `handleAndMark` in `event-log.service.ts` marks nothing once stopped, and the next launch hands it to the rules again within the event log's one-hour replay window.
- The runner no longer hears the agent events that `chat.stop()` emits, so a run that stop cut short is settled by its recovery at the next launch.
- Tests wait with `settled()` instead of a fixed sleep.
- What must stay true: every start of background work in the automations platform goes through the shared `BackgroundWork`, and `Modules.shutdown()` awaits `automations.settled()` after `chat.stop()` and before `quit()` closes the database.
- Enforced by `src/lib/automations/platform/register.test.ts` ('lets the work it started finish before the database closes': a `chat.start-session` call still held at `dispose()` finishes before the database closes, with nothing logged), `src/lib/automations/platform/reconciler.service.test.ts` ('lets Malini close without waiting on news queued behind a decision it is making': `dispose()` lets go of an event queued behind the model's decision, so `settled()` does not wait out its budget), `src/lib/automations/platform/event-log.service.test.ts` ('leaves an event it was still handling when it stopped for the next start, never touching the database after': `settled()` replaces its 20-millisecond sleep, the event stays unhandled and nothing is logged), `src/lib/automations/platform/automation-experiments.test.ts` ('stops the replays an experiment still has queued once you use another one': it waits for the replays with `settled()`) `src/main/modules.test.ts` ('stops a dependency install when Malini quits': the real `shutdown()` sends `SIGTERM` to a running install) and `src/lib/shared/repositories/platform/provisioning.service.test.ts` ('stops waiting on an install whose process group refuses the signal, so a quit goes on': `abortAll()` returns at once when the signal fails with `EPERM`).
  Nothing tests the 5-second settle budget, the late log line, the order of `Modules.shutdown()`, or that the reconciler and the suggestions go through `BackgroundWork`.
