# 0017 - Steering interrupts the turn, not Claude Code

Status: accepted

## Context

A prompt sent with ⌘↵ while a chat runs steers it: it interrupts the turn and runs at once instead of waiting in the queue.
Steering used to be `chat.cancel-run` followed by a fresh send, and the bridge cancels a run by aborting and closing its query, which ends the Claude Code process and every background command and agent it runs (ADR 0009).
The user reported background tasks dying when they sent a message: "Because it's a background task, right?"
Their own history showed it: a background `Launch Grip` command and a background measurement run were each killed a second before a steered prompt started.
In the `claude` CLI, Esc stops the turn and leaves background work running, and a probe of the real SDK showed the same: `interrupt()` ends the turn with a result naming the old prompt, the next prompt pushed into the same query runs, and the background command still finishes and notifies.

## Decision

- `send_prompt` carries `steer: true`, from `chat.send-prompt` through main to the bridge; the bridge protocol is version 26.
- `AgentRunLeases.acquireRun` lets a steering prompt into a chat with open runs and main sends it without a resume point, as it does for a run that only waits.
- `ClaudeSession.sendPrompt` with `steer` hands the prompt to the open query (`packages/agent-bridge/src/claude/session.ts`, `#handOff`):
  a run still in its turn is reported `run.failed: cancelled`, then `interrupt()` ends the turn and the prompt is pushed into the same query, with the live tasks moved to the new run;
  a run whose turn already answered is completed `handedOff`, the same as ADR 0009.
- The error results Claude Code writes for tools the interrupt cut short are left out of the transcript (`ClaudeTranscript.interruptTurn`), as for a stop.
- A steer that changes the access level, the mode, the report resolution or the skills cannot change a running Claude Code process, so the bridge cancels the run and starts a new one, and only then does background work end.
- The renderer steers through `promptDelivery.steer`, retrying every 100 ms while another prompt is still being handed to the chat.
  A queued prompt meant for a fresh chat still stops the running one before it starts.
- Stop is unchanged: `chat.cancel-run` ends the run, Claude Code and its background work.

## Consequences

- Steering keeps background commands and agents running, and their results reach the steered run.
- The interrupted turn's cost is counted in the steered run, since Claude Code reports it only in the turn's result, which no longer belongs to a reported run.
- A steer that lands as the turn finishes may report a completed turn as cancelled; the prompt still runs.
- Enforced by the bridge tests in `session.test.ts` that steer a run with a live background command and steer one whose access level changes, the lease test in `lifecycle.test.ts`, the steer tests in `commands.test.ts`, `send-queued-prompt.command.browser.test.ts` and `submit-prompt.command.browser.test.ts`, and `tests/e2e/background-agents.spec.ts`.
