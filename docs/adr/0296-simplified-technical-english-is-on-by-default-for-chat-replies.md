# 0296 - Simplified Technical English is on by default for chat replies

Status: accepted

## Context

ADR 0178 made **Plain replies** a switch that is off until turned on, and below the high report resolution it also held a reply to 135 words.
The user got ASD-STE100 replies only from a line in their own `~/.claude/CLAUDE.md`, and said Malini "shouldn't be depending on my individual config it should be something that Malini is enforcing because it's actually very convenient for user".
With the switch on, the length rule cut too much: "it's just skipping too much and I feel handicapped".
The report resolution already sets how long a report is (ADR 0285 and the `REPORT_BODIES` in `instructions.ts`), so a second word limit fought it.
The user wants the standard for "regular conversation and chat", while documents and copy stay "up to users preference".

## Decision

- `writesSte` in `src/contract/agent.ts` reads `chat.ste-replies` as on unless it is `off`, as `compactsOutput` does, so a new install and every install that never touched the switch get ASD-STE100 replies.
  An install that turned it on keeps `on`, and one that turned it off keeps `off`.
- The length rule is gone: `ReplyCheck`, `replyCheckInstructions` and the `Stop` hook in `packages/agent-bridge/src/claude/session.ts` carry no `terse` flag, and the report resolution alone sets length.
- `STE_INSTRUCTION` in `packages/agent-bridge/src/claude/reply-check.ts` asks for ASD-STE100 in every chat reply, says the standard sets how the agent writes and never how much, and leaves files the agent writes, such as docs, copy, code comments, commit messages and pull requests, in the style their project asks for.
- The checker's STE rule tells the small model that a fix rewrites the words and keeps every fact, and never asks a reply to drop content or get shorter.
- The switch is **Settings → Models → Plain English**, "Agents talk like a flight manual. Same facts, less to parse. Docs untouched", the name and line the user picked of three drafts in a prototype.
- Everything else in ADR 0178 holds: the callback `Stop` hook with the provider's small model, one send-back per reply, the transcript that shows only the rewrite, and `canContinue` starting a fresh Claude Code when the switch changes.

## Consequences

- Every reply of a new install waits for the small model, a few seconds on a pass, where before only a reply that `mayAskUser` flagged waited.
- A long answer stays long: a user who wants it short picks a lower report resolution or asks for it in the prompt.
- The checker cannot see files the agent writes, so the scope rule for docs and copy rests on the instruction alone.
- Enforced by `instructions.test.ts` (the chat-only STE instruction at every report resolution, with no word limit), `reply-check.test.ts` (STE rules only while the switch is on, no length rule either way) and `tests/e2e/settings.spec.ts` ("Settings → Models turns off Plain English, on by default, for the next prompt of every chat").
