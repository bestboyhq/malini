# 0095 - Auto mode's outages retry quietly, then trust edits

Status: accepted

## Context

On 2026-10-27, during Anthropic's "Elevated errors for Claude Sonnet 5.5" incident, Malini recorded 6 `Classifier unavailable` blocks in 4 chats across 2 workstreams, and each held its run for 15 to 31 minutes until the user answered its card; the user called it a "horrible experience" that "interrupts your workflow".
Claude Code 2.1.293 gets auto mode's verdict from the server with each response (`safeguard_results`); with no verdict it denies the call with the reason `Classifier unavailable`, tells the model the failure is transient and that it may retry once, slows repeated no-verdict responses from 0.5 s doubling to 32 s, and ends the turn after 10 in a row.
ADR 0060's `PermissionDenied` hook asked about every denial, so it held a passing outage like a verdict, and a blip recorded without the card recovered on the model's first retry.
In auto mode the server judges edits inside the workstream too, so an `Edit` of `src/contract/events.ts` was blocked, while `setPermissionMode('acceptEdits')` from inside the hook applies to the next call and to the subagents started after it (probes recorded through the fault proxy).
This changes 0060's first decision for the reason `Classifier unavailable`; the rest of 0060 stands.

## Decision

- The bridge's `PermissionDenied` hook (`packages/agent-bridge/src/claude/session.ts`) does not ask about the reason `Classifier unavailable`: it waits 5, 10 and 20 s and answers `retry: true` without the `PreToolUse` allow, so each retry gets a fresh verdict.
- When a call's retries run out, the check counts as down for 5 minutes in every chat of the bridge, through the one `AutoModeOutage` (`permissions.ts`) that `createClaudeProviderFactory` shares.
  The chat then calls `setPermissionMode('acceptEdits')` and answers `retry: true`: edits inside the workstream go through by Claude Code's own acceptEdits rules, the trust **Sandboxed** gives edits, and everything else reaches `canUseTool` and asks.
  A chat that meets the reason while the check is down falls back without retrying, and each chat returns to `auto` once the 5 minutes pass.
  Claude Code's stop after 10 no-verdict responses (`Auto mode unavailable`) falls back without a card, since the turn ends either way.
- An ask during the fallback, and a call blocked again after its fallback retry, carries `autoModeUnavailable` and the reason "Auto mode couldn't check this call: Anthropic's safety check is down."; its deny is **Keep blocked**, which lets the run carry on, and the call's row reads **not checked**, like the retried attempts.
  The bridge protocol is version 42.
- The renderer gathers the pending approvals with `autoModeUnavailable` of every chat other than the one shown and its children (`waitingElsewhere` in `child-requests.ts`) into one **calls waiting** row in the composer tray, which opens them in the request queue of ADR 0077; unlike a child's request, the queue waits for **Answer** instead of taking the composer slot.
- After **Keep blocked**, the renderer moves the chat back to running, since its run carries on.
- Malini's instructions say the retry line means Malini lets the agent try that exact call again.
- `fault-proxy.mjs` gains `FAULT_KIND=verdict` with `FAULT_RESPONSES`, which drops the verdicts of the first N responses or of `all`; with `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1`, Claude Code keeps the server-only check it uses against api.anthropic.com instead of falling back to its local classifier.

## Consequences

- A short outage costs seconds and no card; a long one costs about a minute on its first call, then the chat runs as Sandboxed without the sandbox, and the calls it asks about wait in one row.
- During the fallback, edits inside the workstream run unchecked, the trust Sandboxed already gives them, and a checkpoint restore undoes them.
- The detection keys on Claude Code's reasons `Classifier unavailable` and `Auto mode unavailable`; if Claude Code renames them, a no-verdict denial asks like any other block, so nothing gets less safe.
- Retries spend model requests, and each no-verdict response counts toward Claude Code's stop after 10, so an outage spends 4 responses before the fallback.
- Enforced by the bridge tests in `session.test.ts` that replay the recorded `classifierBlip` and `classifierOutage` scenarios, by `activity-group.test.ts`, `agent-interactions.aggregate.svelte.test.ts` and `protocol.test.ts`, and by `tests/e2e/agent-interactions.spec.ts`.
