# 0200 - A turn ends one of four ways, and an interrupted turn is not a failure

Status: accepted

## Context

A turn ends when the agent completes it, when it fails, when you stop it, or when Malini cuts it short: Malini quits, its agent bridge restarts, or **Restart agent process** resets the workstream's runs.
Each reader told these apart on its own, and the state machine audit found "an interruption is compared 4 ways (`===`, two regexes, a `resume_at` column)".
On main, the turn list called a run that Malini closed at quit or after a bridge restart `interrupted` and one a reset closed `failed`, while `chat:turn-finished` and the session fold called all three `failed` and the database stored `idle` (0199).
Attention said "needs attention" after a bridge restart or a reset but not after a quit, an automation run finished `failed` with the error as its detail, and Shipping gave back a fix attempt only when that detail was exactly `Interrupted when Malini closed`.
So `where status is failed` fired, the user was asked to look, and a fix attempt was spent when Malini, not the agent, ended the work.

## Decision

- `runEnding(error, paused)` in `src/contract/agent-state-machine.ts` is the one place that names how a run ended, as a `RunEnding`: `succeeded`, `failed`, `cancelled` or `interrupted`.
  A run ends `interrupted` when a limit paused it (`resumeAt`, 0100) or its error is one Malini writes when it cuts a run (`isInterruptionError`), `succeeded` with no error, `cancelled` when you stopped it (`isCancellationError`), and `failed` on every other error.
- Malini writes the four interruption errors, all exported from the contract, only where it cuts a run: `PAUSED_FOR_EXIT_ERROR` in `pausedForExit` for a run it pauses to quit, `ORPHAN_INTERRUPTED_ERROR` in `reapOrphansOnExit` and `reapOrphansOnStartup` for a run still open at quit or at the next launch, `BRIDGE_INTERRUPTED_ERROR` in `terminalizeRunsAfterBridgeLoss`, and `RESET_BY_USER_ERROR` in `resetWorkstreamRuns`, which `chat.reset-workstream-runs` runs when you press **Restart agent process**.
  `RESET_BY_USER_ERROR` moves from `lifecycle.ts` into the contract, and `isInterruptionError` now knows it.
- Every reader of a turn's end asks `runEnding`:
  - `nextSessionStatus` stores `failed` only for `failed`, and `idle` for the other endings (0199).
  - The turn list: `chatTurnStatus` in `src/lib/chat/platform/runs.repository.ts` gives `running` or the ending, and `ChatTurnStatus` is `'running' | RunEnding`.
  - `chat:turn-finished`: `FinishedTurns` in `src/lib/chat/platform/finished-turns.ts` sends the ending as `status`, `ChatTurnFinishedStatus` is `RunEnding`, and its reader in `src/lib/chat/platform/register.ts` accepts only what `isRunEnding` accepts.
    A turn that Malini paused to quit, or that a limit paused, still fires nothing (0085, 0100).
  - `continuableRun`, which **Continue** reads, goes on after every ending with an error except `cancelled`.
  - `agentAttentionDecision` asks for attention on a `run.failed` only when `runEnding(error, resumeAt !== undefined)` is `failed`.
  - The automation runner: `#ended` finishes an automation run with the ending of its turn, and `#recoverRun` finishes a run that has no chat, or whose chat folds to `idle` or `failed` at launch with no pause, as `interrupted` with `AUTOMATION_INTERRUPTED_DETAIL`.
- The transcript words it the same way: `terminalLabel` in `src/lib/chat/presentation/chat-message-list/transcript-labels.ts` says **Run interrupted**, not **Run failed**, for a failed run whose error `isInterruptionError` names, and `RunTerminalBanner.svelte` shows that strip without the failure color and keeps **Try again** beside it.
  A crash, a force quit or **Restart agent process** leaves the sidebar status at **Idle** and the strip at **Run interrupted**.
- An automation run keeps its statuses: `#finish` stores an `interrupted` ending as `failed` with `interrupted: true`, and marks a run that fails after `dispose()` stopped the runner the same way.
  A migration adds `automation_runs.interrupted INTEGER NOT NULL DEFAULT 0 CHECK (interrupted IN (0, 1))` and sets it on each `failed` run whose detail is one of the five texts an interruption wrote.
  `AutomationRunRecord.interrupted` is required, `automationRunInterrupted(run)` reads it, and Shipping (`settleActiveAutomation` in `src/lib/pull-requests/platform/ship-rule.ts`) gives back the fix attempt of every interrupted run.
- The Explorer notes a turn and a `chat:turn-finished` event with `turnNote` (`working`, `interrupted` or `stopped`) and marks only a `failed` one as failed.
  The description of `chat:turn-finished` in `src/contract/event-catalog.ts` says that `where status is failed` skips an interrupted turn.

## Consequences

- One function answers "did this turn fail" for the session, the turn list, `chat:turn-finished`, attention, **Continue** and the automation runner, so they cannot disagree.
- Malini quitting, an agent restart or a reset no longer fires `where status is failed` on `chat:turn-finished`, asks for attention, marks the chat `failed` or spends a fix attempt.
- A new ending changes `RunEnding`, and `pnpm check` fails until `CHAT_TURN_STATUS` in `src/lib/automations/presentation/automation-run-status.ts` shows it; a new way for Malini to cut a run is one more constant in `isInterruptionError`.
- The four error texts stay as they are: `agent_runs.error` stores them, and `runEnding` reads stored turns by them.
- An interrupted automation run still has the status `failed`: the automations page and the Explorer show it as failed, `automations:run-finished where run.status is failed` fires on it, and the reconciler offers to retry it.
  Only `automationRunInterrupted` tells it apart, and only Shipping reads it.
- A lead still hears that a workstream it started failed its turn when that turn was interrupted: `#reportToStarter` in `src/lib/chat/platform/deliveries.service.ts` reports every ending except `succeeded` and `cancelled` as `failed`.
- Enforced by `src/contract/agent-state-machine.test.ts` ("ends a run that Malini, the bridge or a reset cut as quietly as a stop", "names how a run ended once, for the session, the turn and the transcript"), `src/lib/chat/platform/finished-turns.test.ts` ("tells how a turn ended in the words the turn list uses for it", "stays quiet for automation sessions, for turns Malini paused to quit, and mid-turn", "stays quiet for a turn a limit paused, and tells of the turn that goes on from it"), `src/lib/chat/domain/agent-attention.test.ts` ("asks for no attention when a stop, a restart or a reset ended the turn"), `src/lib/automations/platform/register.test.ts` ("counts an automation whose agent bridge restarted as interrupted", "counts a run that closing Malini cut short as interrupted, not as failed"), `src/main/db/migrations.test.ts` ("marks a run that failed with an interruption as interrupted, and no other run"), `src/lib/pull-requests/platform/ship-rule.test.ts` ("spends no fix attempt on an automation Malini interrupted when it closed") and `src/lib/automations/presentation/automations/explorer-copy.test.ts` ("notes a finished turn the way it notes the turn itself"), `src/lib/chat/presentation/chat-message-list/transcript-labels.test.ts` ("says a run that malini, its agent process or a reset cut is interrupted, not failed") and `tests/e2e/agent-bridge-failures.spec.ts` ("an agent process that stops responding mid-run is announced, and restarting it from the banner lets the chat go on").
