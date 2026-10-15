# 0009 - A run stays open while its background work runs

Status: accepted

## Context

Claude Code lets the agent start work in the background: a command with `run_in_background`, or a background agent.
When that work finishes, Claude Code starts a follow-up turn of its own so the agent can read the result.
The bridge used to end a run at the first `session_state_changed: idle` and close the query, which killed every background command along with the Claude Code process.
An agent that said "I'll wait for the e2e run" could never keep that promise, and the user had to ping it.
The main process allows one open run per chat, and checkpoints, change capture and undo are built around runs, so any work that happens outside a run is work undo cannot reach.

## Decision

- A run stays open until Claude Code is idle with no live background task (`packages/agent-bridge/src/claude/session.ts`, `#consume`).
  The live set comes from Claude Code's `background_tasks_changed`, without tasks it marks `ambient`.
- The bridge reports that set as the `background.updated` event: the tasks with their kind, description and start time, and whether the run only waits on them (`waiting`).
  A change to the tail of a command's output file or an agent's progress line is sent as `interim` and never persisted, the same as interim `usage.updated`.
- The `stop_task` command stops one task through the SDK's `stopTask`, and the renderer exposes it as `chat.stop-background-task`.
- A prompt sent to a chat whose run only waits takes that run over instead of queueing behind it.
  `AgentRunLeases.acquireRun` lets the new run in when every open run of the chat is waiting (its latest `background.updated` says `waiting`), and main sends it without a resume point.
  The bridge then completes the old run with `handedOff: true`, pushes the prompt into the same open query, and moves the live tasks to the new run.
  A prompt that changes the access level, the mode or the report resolution cannot change a running Claude Code process, so the bridge refuses it with `RUN_ACTIVE` and it waits in the queue.
- A handed-off completion raises no chime and no attention mark, because the user caused it.

## Consequences

- Changes a background agent makes land in the run that started it, so undo and the run's changed files cover them.
- The chat shows the live tasks above the composer, with each task's latest output line and a stop button, plus the queued and running jobs of the workstream.
- A chat waiting on background work keeps its sidebar spinner until the work settles, and quitting the app still stops the work with the run.
- Background work does not survive an app restart; Claude Code reports it as stopped on the next resume.
- Enforced by the bridge tests in `session.test.ts` that replay the recorded `backgroundCommand` and `stoppedBackgroundCommand` runs, by the lease test in `lifecycle.test.ts`, and by `tests/e2e/background-agents.spec.ts`.
