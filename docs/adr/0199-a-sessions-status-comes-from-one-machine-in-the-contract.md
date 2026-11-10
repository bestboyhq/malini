# 0199 - A session's status comes from one machine in the contract

Status: accepted

## Context

A chat's `agent_sessions.status` (`idle`, `running`, `waiting_for_approval`, `completed`, `failed`) drives the sidebar, the composer, the prompt lease and the automation runner.
The state machine audit found "5 copies of one machine": the contract fold, the renderer's fold in `sessions.aggregate.svelte.ts`, the writes in `sessions.repository.ts`, a direct `UPDATE` in `interactions.repository.ts` and a SQL `CASE` in `listSessionSummaries`, plus `resumeRunAfterInteraction`, which moved the renderer from `waiting_for_approval` to `running` beside the fold.
They disagreed: a lost prompt, a quit, a bridge restart and a reset stored `idle` where the fold of the same `run.failed` said `failed`, and the `CASE` listed every turn that ended with an error as `failed`, so a chat you stopped read Failed in the sidebar of a workstream you had not opened.
An answer stored `running` even while the run still waited on another request, and a reload folded a chat you had answered back to waiting for approval, since `approval.decided` was not a lifecycle kind and an answered question left no event at all.
The bridge's `session.state` also wrote the status, and the transition table answered `invalid` for moves it did not list, which `finalizeRunLifecycle` threw on.

## Decision

- `nextSessionStatus(status, kind, guard)` in `src/contract/agent-state-machine.ts` is the only rule for a session's status, and it answers every status on every `LifecycleEventKind`; `invalid` is gone.
  `run.started` gives `running` from any status, and `approval.requested` and `question.requested` give `waiting_for_approval`.
  `approval.decided` and `question.answered` give `running` from `waiting_for_approval` once no request of the session still waits (`guard.stillWaiting`), and leave every other status as it is.
  `run.completed` gives `completed`, `run.failed` gives `failed` only when `runEnding` says the turn `failed` and `idle` for a stop, a pause or an interruption (0200), and `checkpoint.restored` gives `idle`.
- `LIFECYCLE_KINDS` adds `approval.decided` and `question.answered`.
  `answerAgentQuestion` stores and emits `question.answered` with its `questionId`, as `decideAgentApproval` already did `approval.decided` with its `approvalId`.
- In the main process every write of a status goes through `moveSessionStatus` (`src/lib/chat/platform/sessions.repository.ts`): it reads the stored status and whether an interaction of the session is still `pending` or `dispatching`, asks `nextSessionStatus` and writes only a change.
  Its callers are `sendAgentPromptLeased`, `pumpStep` for each lifecycle event of the bridge that does not end the run, `finalizeRunLifecycle` for the one that does and `handleSendPromptHandoffFailure` for a prompt the bridge never took, each once no other run of the session is open (`sessionHasOpenRun`), `finalizeInteractionResponse`, `terminalizeRunsAfterBridgeLoss`, `reapOrphansOnStartup`, `reapOrphansOnExit`, `resetWorkstreamRuns` and both checkpoint restores.
  The one other write, `repairSessionStatusesWithoutOpenRuns`, stores `foldSessionStatus` of the session's stored lifecycle events.
- A `session.state` event writes no status; `pumpStep` keeps only its `providerSessionId`, and `durableSessionStatus` and `setSessionStatus` are gone.
- `chat.list-sessions` (`listSessionSummaries`) returns the stored status with no SQL `CASE`, and `listElementThreads` reads a thread's wait from it through `isWaitingForUser`.
- The renderer folds the same events with the same functions: `sessionsAggregate` runs `foldSessionStatus` on a replay and `foldSessionStatusIncremental` on live events, both through `nextSessionStatus`, and keeps each session's ended runs and open requests (`terminatedRunIds`, `openRequests`) between batches.
  `resumeRunAfterInteraction` is gone; the automation runner reads a chat's status with `foldSessionStatus` too.
- A prompt the bridge never takes closes its turn with `run.failed`, so the chat reads `failed` in the database as in the fold, where it read `idle` before.
  `AgentRunLeases.acquireRun` refuses a prompt only while the stored status is `running` or `waiting_for_approval`, so a `failed` chat takes its next prompt.
- An approval or answer for a turn that already ended is refused before it reaches the bridge as `run_ended`, "`<id>` belongs to a turn that already ended", also when the bridge answers `INTERACTION_RUN_NOT_ACTIVE` or `NO_SESSION`, and its card reads **No longer active**.

## Consequences

- The database, `chat.list-sessions`, the renderer and the automation runner give one status for one log of events, before and after a reload or a restart.
- A chat you stopped, or one a quit, a bridge restart or a reset cut short, reads `idle` everywhere; only a turn that failed reads `failed`.
- A chat you answered reads `running` after a reload, and a run with two open requests waits until you answer both.
- A new lifecycle kind changes `nextSessionStatus` once, and `pnpm check` fails until its `switch` handles it; nothing in the main process writes `agent_sessions.status` outside `moveSessionStatus` and the repair, and no reader projects a status of its own from `agent_runs`.
- An event out of order moves the status instead of throwing; the fold drops a late event of a run that already ended (`terminatedRunIds`), and `finalizeRunLifecycle` moves the status only for a run it closed itself.
- Enforced by `src/contract/agent-state-machine.test.ts` ("moves to where each lifecycle event leads", "moves the fold exactly as nextSessionStatus says, from every status on every kind", "goes back to running once the user answers the last request a run waits on", "ends a run that Malini, the bridge or a reset cut as quietly as a stop"), `src/lib/chat/platform/sessions.repository.test.ts` ("agrees with the event fold after a stop, a pause, a bridge restart and a lost prompt", "agrees with the event fold while a run waits on the user and after each answer", "agrees with the event fold when a repair or a restore rewrites a closed run", "lists the stored status and repairs stale busy sessions"), `src/lib/chat/platform/agent/commands.test.ts` ("closes the run when the bridge never takes the prompt", "closes the turn as failed when it cannot be prepared, so the chat never waits on it", "keeps a chat running when a steer fails before it reaches the live run"), `src/lib/chat/infrastructure/aggregates/sessions.aggregate.test.ts` ("waits for structured input and resumes only the matching active run") and `tests/e2e/chat-session-status.spec.ts` ("a chat you answered still shows it runs after a reload", "a chat you stopped does not show as failed from another workstream", "allowing a call the run already left behind says it is no longer active").
  No test sends a second prompt to a chat that failed after a lost prompt.
