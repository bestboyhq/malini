# 0047 - A prompt in other settings replaces a waiting run

Status: accepted

## Context

0009 let a prompt take over a run that only waits on background work, and had the bridge refuse it with `RUN_ACTIVE` when it changed the access level, the mode or the report resolution, expecting it to wait in the queue.
Main never queued it: `AgentRunLeases.acquireRun` lets the prompt in because the run waits, the bridge refuses it, and the prompt fails.
The user's chat failed every prompt for half an hour, each with `SEND_PROMPT_FAILED: RUN_ACTIVE`, until they restarted Malini: "smh broke".
Its run had been continued after a restart while a dev server ran in the background, and it started in the system's dark theme, because the theme mode lived only in the renderer, which syncs it after paused runs continue.
Every later prompt carried the user's light theme, which 0039 added to `canContinue`, so each one was refused for as long as the dev server lived.
Any change of access, mode, report resolution, skills or theme hit the same wall while a run waited.

## Decision

- A run stays open until Claude Code is idle with no live background task (`packages/agent-bridge/src/claude/session.ts`, `#consume`).
  The live set comes from Claude Code's `background_tasks_changed`, without tasks it marks `ambient`.
- The bridge reports that set as the `background.updated` event: the tasks with their kind, description and start time, and whether the run only waits on them (`waiting`).
  A change to the tail of a command's output file or an agent's progress line is sent as `interim` and never persisted, the same as interim `usage.updated`.
- The `stop_task` command stops one task through the SDK's `stopTask`, and the renderer exposes it as `chat.stop-background-task`.
- A prompt sent to a chat whose run only waits takes that run over instead of queueing behind it.
  `AgentRunLeases.acquireRun` lets the new run in when every open run of the chat is waiting (its latest `background.updated` says `waiting`), and main sends it without a resume point.
  The bridge then completes the old run with `handedOff: true`, pushes the prompt into the same open query, and moves the live tasks to the new run.
- A prompt that changes what `canContinue` compares (access level, mode, report resolution, skills or theme) cannot change a running Claude Code, so `ClaudeSession.sendPrompt` cancels the waiting run, which ends its background work, and starts a new Claude Code that resumes the conversation, as a steer does (0017).
  The bridge refuses with `RUN_ACTIVE` only a prompt that neither steers nor reaches a waiting run.
- Main saves the theme mode in its settings under `app.theme-mode` and follows it in `registerModules` before chats register (`followSavedThemeMode` in `src/lib/app/platform/register.ts`), so a run continued at boot starts in the user's theme.
- A handed-off completion raises no chime and no attention mark, because the user caused it.

## Consequences

- No setting change can wedge a chat: the prompt always runs, at the cost of the background work of the run it replaces.
- The replaced run reads as cancelled in the transcript, though its turn had answered.
- Changes a background agent makes land in the run that started it, so undo and the run's changed files cover them.
- A chat waiting on background work keeps its sidebar spinner until the work settles, and quitting the app still stops the work with the run.
- Background work does not survive an app restart; Claude Code reports it as stopped on the next resume.
- Enforced by the bridge tests in `session.test.ts` that replay the recorded `backgroundCommand` and `stoppedBackgroundCommand` runs and restart Claude Code for a waiting run's prompt with another access level, skills or theme; by the lease test in `lifecycle.test.ts`; by the boot theme test in `src/lib/app/platform/register.test.ts`; and by `tests/e2e/background-agents.spec.ts`.
