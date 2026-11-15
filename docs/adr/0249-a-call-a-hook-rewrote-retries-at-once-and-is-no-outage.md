# 0249 - A call a hook rewrote retries at once and is no outage

Status: accepted

## Context

In the "Intel Mac" workstream (2026-11-13 to 2026-11-15) Claude Code refused 66 Bash calls with "a hook changed this call's input after auto mode reviewed it", each caused by the user's `rtk hook claude` `PreToolUse` hook, which returns `updatedInput` with no decision.
A probe with a real Claude Code 2.1.325 in `auto` mode and that hook proved that the bridge's `PermissionDenied` hook gets the reason `Classifier unavailable` for this denial, the same reason as an outage, with the hook's input as `tool_input`.
0097 treats that reason as an outage: each call waited 5, 10 and 20 s, and a call whose retries ran out switched every chat of the bridge to `acceptEdits` for 5 minutes.
Nothing is down: Claude Code tells the model to send the call again with exactly the hook's input, and a hook that leaves its own output unchanged, as RTK's does, lets auto mode review what runs on that retry.

## Decision

- A `PreToolUse` callback (`#noteAskedInput` in `packages/agent-bridge/src/claude/session.ts`) keeps each call's input by `tool_use_id` until the run ends.
- When a `Classifier unavailable` denial carries another `tool_input` than the call asked for, `#askAboutBlockedCall` answers `retry: true` at once, without the `PreToolUse` allow, so auto mode reviews the hook's input.
  It never waits and never reaches `#retriedUnchecked`, so it neither counts toward a call's retries nor confirms `AutoModeOutage`.
- When the hook changes a call that was such a retry again, the block stands with no retry (`rewrittenRetries`), so a hook that never settles cannot hold the agent in a loop; Claude Code's own text tells the model not to try again.
- A denial whose `tool_input` matches what the call asked for is an outage, and 0097 stands for it.
- The recorder (`.agents/skills/claude-runtime/scripts/record.mjs`) follows the same rule, and `REWRITE_HOOK=1` adds `scripts/rewrite-hook.mjs` as a flag-settings `PreToolUse` command hook that puts `command ` in front of a Bash command once, as RTK's hook puts `rtk`; it recorded the `hookRewrite` scenario.

## Consequences

- A user's hook that rewrites calls costs one more model call for each call it changes, and no wait, no card and no fallback in any chat.
- The detection rests on Claude Code handing the `PermissionDenied` hook the hook's input; if a later version hands it the input the agent asked for, a rewrite counts as an outage again, as it did before, which is no less safe.
- Each run holds a reference to the input of every tool call it makes until the run ends.
- This amends 0097 for denials a hook caused; the rest of 0097 stands.
- Enforced by the bridge tests in `session.test.ts` that replay the recorded `hookRewrite` scenario ("retries at once, and counts no outage, when a hook changed the call after auto mode checked it", "lets the block stand when the hook changes the retried call again").
