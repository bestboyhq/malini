# 0220 - A turn that ends over background commands is a session state

Status: accepted

## Context

0037 made a turn that ends with only background commands left read as finished, and 0009 keeps its run open until they stop.
The session machine of 0199 had no event for that moment, so the stored status stayed `running` until the run closed.
Each reader re-derived "the agent works" from open runs and background tasks by hand: SQL in `events.repository.ts`, the top bar, the chat tab, the workstream row, the transcript's status line and the lifecycle monitor.
The copies drifted.
A chat whose turn left a dev server up said **Waiting on 1 background command** and the top bar said **Commands running**, a busy state, while the workstream was done.
The user asked that a dev server left running never read as an agent working.

## Decision

- The bridge protocol (v54, `packages/agent-bridge/protocol/bridge-protocol.json`) adds `turn.ended` and `turn.resumed`, each with only its `runId`.
  `ClaudeTranscript` (`src/claude/transcript.ts`) emits `turn.ended` once a turn has its result, Claude Code is idle and every task left is a command, and `turn.resumed` when Claude Code works again in the same run.
- Both are lifecycle kinds in `src/contract/agent-state-machine.ts`: `turn.ended` moves `running` to `completed`, and `turn.resumed` moves `completed` back to `running` and leaves every other status alone.
  `pumpStep` stores the move through `moveSessionStatus`, and the renderer folds it in `sessionsAggregate`, as for every other lifecycle kind (0199).
- `isAgentWorking(status)`, `running` or `waiting_for_approval`, replaces `hasOpenRun` as the one answer to "the agent works".
  `workstreamHasWorkingRun` and `sessionHasWorkingRun` add it to the open-run SQL; the workstream running query, the top bar, the chat tab, the workstream row and the abort guard read the status, not the background tasks.
- The top bar drops **Commands running**, the chat tab drops **Background commands running**, and the status line drops **Waiting on N background command** once the turn ended.
  A background agent, or a task that is not a command, still keeps the turn open and the status `running`.
- The lifecycle monitor passes every lifecycle kind to the session fold (`isLifecycleKind`), and only an approval, a question, a run's end or a turn's report on `background.updated` raises attention, so a chat off screen moves too.
- The run row stays open while its commands run (0009, 0215), and the reply text and provider cursor still travel on `background.updated`, so shipping, deliveries and the automation runner keep their wait (0122).

## Consequences

- Every reader of "the agent works" reads one stored status, so a new reader needs no rule of its own.
- An open run no longer means a busy workstream: code that needs the run row, such as a checkpoint restore, asks `workstreamHasOpenRun`, and code that needs a working agent, such as deliveries, the reconciler, `workstreams_list` and stopping commands before a merge, asks `workstreamHasWorkingRun` or `sessionHasWorkingRun`.
- Closing a chat whose commands still run asks first, from its background tasks, since closing stops them.
- Malini still does not track a process an agent detached from its command, and an agent cannot stop a process an earlier command started when the sandbox refuses the signal.
- Enforced by the state machine tests in `agent-state-machine.test.ts`, the transcript tests in `packages/agent-bridge/src/claude/session.test.ts`, `runs-events.repository.test.ts`, `deliveries.service.test.ts`, `agent-lifecycle-monitor.service.test.ts`, `render-projector.test.ts`, and `tests/e2e/background-agents.spec.ts`, whose fake bridge emits both events.
