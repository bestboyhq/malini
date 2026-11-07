# 0177 - A small model checks each reply for Simplified Technical English

Status: accepted

## Context

The user wanted every agent reply in ASD-STE100 Simplified Technical English and under 135 words.
A line in `CLAUDE.md` is a rule, and an agent drifts from a rule in a long session, so the user asked for a gate: "i like model gate".
A first gate lived in `~/.claude/settings.json`, and the user turned it down: "u shouldnt've mangle my settings, but make it built into malini".
A Claude Code `prompt` Stop hook cannot do the job: its evaluator sees only the hook input, never the user's prompt, so it cannot honor "reply casually" or "in detail", and in a tracer run it read its own prompt as a condition and sent one reply back five times.
`applyFlagSettings` adds hooks rather than replacing them, and a `continue: false` from a Stop hook ends the turn with an empty result, so neither can carry the check either.

## Decision

- **Settings → Models → Plain replies** is a switch, off until turned on, saved as `chat.ste-replies` in the settings table, `on` when on.
  `writesSte` in `src/contract/agent.ts` reads it: only `on` is on.
- Main's `steReplies` hook in `src/lib/chat/platform/agent/service.ts` reads it for each prompt, and `send_prompt` carries `steReplies: true` while it is on.
- The bridge (`packages/agent-bridge/src/claude/reply-check.ts`) adds the STE line to the `<malini>` instructions, with the 135-word limit only below the high report resolution, and registers a callback `Stop` hook on the query.
- The hook sends the turn's prompt and `last_assistant_message` to a one-turn, tool-less, hook-less Claude Code on `haiku`, the provider's small model through `ANTHROPIC_DEFAULT_HAIKU_MODEL`, whose `outputFormat` admits only `{ ok, fix? }`.
  A fail answers `{ decision: 'block', reason }`, which Claude Code hands back as `Stop hook feedback:` and continues the same turn; `stop_hook_active` on the rewrite lets it end, so a reply goes back at most once.
  A check that fails, times out after 30 s or is aborted lets the reply through.
- While the switch is on, `ClaudeTranscript` holds the last top-level reply until a new block, message or result shows it was not the last; the feedback message drops it and discards its streamed preview, so the chat keeps only the rewrite.
- `canContinue` compares `steReplies`, so turning the switch either way gives the chat's next prompt a fresh Claude Code, as a new theme does.

## Consequences

- A reply waits for the check before it settles, a few seconds on a pass, and a sent-back reply costs a rewrite.
- A request for another style or length passes, since the checker reads the prompt beside the reply.
- If a background agent's message arrives between a reply and its check, that reply shows beside its rewrite.
- Enforced by `transcript.test.ts` ("shows only the rewrite of a reply the reply check sent back", and every recorded scenario keeps every reply in order while held), `session.test.ts` (the hook blocks once on the recorded `steRewrite` turn, lets a reply through when the check fails, and runs only once the switch is on, in a fresh Claude Code) and `tests/e2e/settings.spec.ts` ("Settings → Models turns on plain replies for the next prompt of every chat").
