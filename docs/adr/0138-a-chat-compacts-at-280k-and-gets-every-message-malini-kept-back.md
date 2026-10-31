# 0138 - A chat compacts at 280K and gets every message Malini kept back

Status: accepted

## Context

Claude Code owns compaction (0005), and for Opus 5.5 it compacts only near the full 1M window, at about 967K tokens.
In the user's week of chats, requests above 400K were 21% of calls but 45% of input tokens, and each of the 19 typed `/compact` runs stalled for 60 to 135 seconds.
The user: "You almost never want to work on one million context window filled up", and asked how anyone can know what a compaction dropped.
An evaluation on 16 of their long chats found that one compaction keeps 70% of what mattered (95% without one), and that Malini's own record of the chat, each prompt and each reply, is 1-2% of the context.
Putting every message Malini kept back right after the compaction lifted recall to 86%; the record `restoredConversationHistory` built reached 77%, because it dropped every turn a mid-run prompt or a restart cut short.
A sweep of compaction windows with the record put back picked 280K (95% range 220K to 300K): recall holds down to 300K and drops at 200K, while cost barely falls below 300K.
Claude Code 2.1.293 keeps a hook's `additionalContext` in the context only up to 10,000 characters and saves anything longer to a file behind a 2 KB preview; it joins the contexts of every `SessionStart` hook with a newline, in the order the hooks finish.

## Decision

- `compactWindowSettings` in `packages/agent-bridge/src/claude/compaction.ts` passes `settings: { autoCompactWindow: 280000 }` to the Claude Code of every chat and job, unless the user, project or local settings file sets `autoCompactWindow`, at the top or under `modelSettings`, where `/autocompact` saves it.
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` still wins inside Claude Code.
- A running Claude Code keeps that flag over a window `/autocompact` saves and answers that a higher-priority override is active, and `applyFlagSettings` cannot take the flag away.
  So a prompt that picks a window, `/autocompact` with a value, runs in a Claude Code started without the flag, and the next prompt starts one that reads the pick.
- `recordHooks` registers 48 `SessionStart` callbacks with the matcher `compact`.
  After a compaction they ask main for the record through `bridge.history_request` and `history_result` (protocol 44), render it as the text the evaluation measured, an intro and a `<previous_conversation>` block, and cut it at newlines into parts of at most 10,000 characters.
  Each callback returns only after the one before it, so the parts reach the model whole and in order; a subagent's compaction gets nothing.
- `conversationRecord` in `apps/malini/src/lib/chat/platform/agent/sessions.ts` builds the record: every prompt and every reply of the chat in order, a run's replies joined, without the turns undone or rewound (`listTimelineEventRows`), the newest within 256 KB and 4,096 messages.
  It replaces `restoredConversationHistory`, so a chat whose Claude transcript is gone starts over with every message too.

## Consequences

- Long chats compact about 12 times as often, mostly during a run, and cost about 76% of what they did; the context gauge counts against 280K.
- After a compaction only tool output is left to the summary, and the agent can read it again from disk.
- A record can take up to about 90K tokens of the 280K, so a chat with a long record compacts sooner.
- A window you pick for any model keeps Malini's 280K out for every model.
- The record depends on Claude Code's 10,000-character cap, its newline join and its finish order: a smaller cap turns parts into file previews, and a Claude Code bump re-checks all three with the `claude-runtime` recorder, which records `SessionStart` hooks.
- Enforced by `compaction.test.ts`, which fits the largest record the bridge accepts into 48 parts, `session.test.ts` ("puts every message Malini kept back after a compaction, in order, in parts Claude Code keeps whole", "compacts at 280K unless the user picked a window with /autocompact", "answers /autocompact in a Claude Code without Malini's window, then goes back to it"), `sessions.test.ts`, the protocol tests of both sides, and `tests/e2e/compact.spec.ts`, whose second test puts the record back without an undone turn.
