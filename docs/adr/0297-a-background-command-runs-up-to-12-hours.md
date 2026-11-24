# 0297 - A background command runs up to 12 hours

Status: accepted

## Context

Claude Code stops a `run_in_background` command at its `timeout`: 30 minutes when the agent gives none, 2 hours at most, and then it wakes the agent.
A dev server left for the user died at that limit, and the agent started it again, so the user restarted servers through the day and called the 2 hours arbitrary.
Malini cannot turn the deadline off: only Claude Code's own host calls `disableBackgroundDeadline()`.
It can raise the cap: Claude Code takes the larger of its 2 hours and `BASH_MAX_TIMEOUT_MS`.
The user asked to let agents pick the timeout under a hard cap of 6 or 12 hours, from how long their work takes.
In the user's Malini, 1,087 sittings (runs less than an hour apart) had a median of 0.5 hours; 15.6% went past 2 hours, 2.5% past 6 and 0.4% past 12, the longest 16.9.

## Decision

- Each run's Claude Code gets `BASH_MAX_TIMEOUT_MS` of 12 hours (`COMMAND_TIMEOUT_CAP_MS` in `packages/agent-bridge/src/claude/session.ts`), set after the inherited environment, so a value in the user's shell does not raise it.
- The agent picks the timeout: Claude Code's Bash tool describes the new maximum, and Malini's instructions (`packages/agent-bridge/src/claude/instructions.ts`) say to start a server with `run_in_background` and the largest `timeout` the Bash tool allows.
- The 30-minute default stays, so a background command that hangs and has no timeout from the agent still stops.

## Consequences

- A dev server lasts the working day; past 12 hours Claude Code stops it and wakes the agent, as before.
- Every other way a command stops stays: its stop button, quitting Malini, merging the base branch into the workstream (0134) and archiving it.
- The same variable raises the foreground limit from 10 minutes to 12 hours; the foreground default stays 2 minutes, and the agent picks a longer one only for a command it waits on.
- A server an agent forgot runs up to 12 hours instead of 2, so a workstream can hold its port and memory longer.
- Enforced by the 'ends the turn whose report leaves its background command running…' test in `packages/agent-bridge/src/claude/session.test.ts`, which reads the variable from the run's options.
