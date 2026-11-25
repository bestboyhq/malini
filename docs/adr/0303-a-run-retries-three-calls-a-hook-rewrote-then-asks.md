# 0303 - A run retries three calls a hook rewrote, then asks

Status: accepted

## Context

Simon reported subagents that burned about 6 million tokens while auto mode kept refusing their calls, with no word to the parent agent or to him, caused by "some bug in my configuration".
A probe with a real Claude Code 2.1.331 in `auto` mode, `REWRITE_HOOK=1` and a subagent that runs five Bash calls showed each call refused with "a hook changed this call's input after auto mode reviewed it" and retried without a card: ten model calls for five, and nothing the user sees.
0249 answers every such denial with `retry: true` and has no limit in a run, so a hook that rewrites every command doubles the cost of every Bash call of every agent and subagent, silently, for as long as the hook stays.
Its only stop is a call whose retry the hook changes again: a call the agent sends again with the input it first asked for, which Malini's instructions allow ("make the same call again, unchanged"), is rewritten to the same input and got `retry: true` again, and our retry line overrides Claude Code's own "do not retry".
Claude Code tells the model to send the hook's input once more whatever the bridge answers, so the bridge cannot save that call; it can only stop the silence.

## Decision

- `#askAboutBlockedCall` in `packages/agent-bridge/src/claude/session.ts` answers `retry: true` without asking for at most `QUIET_REWRITE_RETRIES`, 3, calls a hook rewrote in one run, counted in `rewrittenRetries`, which the run clears when it ends.
- A denial whose asked input or hook input is already in `rewrittenRetries` gets no retry, so a call the agent sends again into the same rewrite ends there, and Claude Code's text tells it to stop and tell the user.
- Past those three, each call a hook rewrote reaches the approval card that 0060 gives a call auto mode blocks, with the reason `HOOK_CHANGED_CALL_REASON` from `permissions.ts` and no `autoModeUnavailable`, since nothing is down and the **calls waiting** row speaks of an outage.
  The run, and every subagent in it, waits on the card; **Allow** lets that call through once, as 0060 does, and **Keep blocked** lets the agent carry on without it.
- The recorder (`.agents/skills/claude-runtime/scripts/record.mjs`) follows the same rule; it recorded `subagentHookRewrites`, the five-call subagent above.

## Consequences

- A user's hook that rewrites every command costs at most three silent extra model calls in a run, and then the user sees the hook named on a card instead of a bill.
- A run with that hook asks about each Bash call after the third, until the user turns the hook off or leaves auto mode; Malini's own command filter (0248) never rewrites in a hook, so it never causes this.
- The count is per run, so each new prompt starts with three quiet retries again.
- This amends 0249; a denial that is an outage stays with 0097.
- Enforced by the bridge tests in `session.test.ts` that replay `hookRewrite` and `subagentHookRewrites` ("lets the block stand when the agent sends the call the hook changed again", "asks about every call a hook changes once three in a run were retried without asking").
