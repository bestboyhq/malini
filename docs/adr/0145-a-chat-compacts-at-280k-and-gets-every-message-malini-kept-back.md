# 0145 - A chat compacts at 280K and gets every message Malini kept back

Status: accepted

## Context

Claude Code owns compaction (0005), and for Opus 5.5 it compacts only near the full 1M window, at about 967K tokens.
In the user's week of chats, requests above 400K were 21% of calls but 45% of input tokens, and each of the 19 typed `/compact` runs stalled for 60 to 135 seconds.
The user: "You almost never want to work on one million context window filled up", and asked how anyone can know what a compaction dropped.
An evaluation on 16 of their long chats found that one compaction keeps 70% of what mattered (95% without one), and that Malini's own record of the chat, each prompt and each reply, is 1-2% of the context.
Putting every message Malini kept back right after the compaction lifted recall to 86%; the record `restoredConversationHistory` built reached 77%, because it dropped every turn a mid-run prompt or a restart cut short.
A sweep of compaction windows with the record put back picked 280K (95% range 220K to 300K): recall holds down to 300K and drops at 200K, while cost barely falls below 300K.
Claude Code 2.1.293 keeps a hook's `additionalContext` in the context only up to 10,000 characters and saves anything longer to a file behind a 2 KB preview; it joins the contexts of every `SessionStart` hook with a newline, in the order the hooks finish.
The user wants the window in Malini's settings, not in Claude Code's: "we would just put 280 or something like that by default as a recommended option and then a slider", "we would definitely want to have Malini be in charge of what the autocompact limit is", and "most people won't even know that there is an option like that".
Claude Code takes a window from 100,000 to 1,000,000 tokens, and `applyFlagSettings` does not change the window of a running Claude Code: it still reported 280K after 500K was applied, before and after a turn.

## Decision

- **Settings → Models → Context window** picks the window: a slider from 100K to 1M in 10K steps, marked at the recommended 280K (`ContextWindowSettings.svelte` on the hyper-ui `Slider`), saved as `chat.context-window` in the settings table.
  `contextWindowOf` in `src/contract/agent.ts` reads it, 280,000 when unset, clamped and rounded to a step.
- Main reads the setting for every prompt and sends it as `compactWindow` on `send_prompt` (the `compactWindow` hook in `src/lib/chat/platform/agent/service.ts`); the bridge accepts 100,000 to 1,000,000 and passes `settings: { autoCompactWindow }` to the Claude Code of every chat and job.
- That flag setting outranks the user, project and local settings files, and a flag window at the top replaces every per-model window `/autocompact` saves under `modelSettings`; only `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and managed settings beat it.
  Malini no longer reads those files, and `/autocompact` left the slash menu.
- A prompt with another window than its idle Claude Code starts a fresh one, as a new theme does; a prompt that steers a running one keeps that one's window until it ends.
- `recordHooks` registers 48 `SessionStart` callbacks with the matcher `compact`.
  After a compaction they ask main for the record through `bridge.history_request` and `history_result` (protocol 44), render it as the text the evaluation measured, an intro and a `<previous_conversation>` block, and cut it at newlines into parts of at most 10,000 characters.
  Each callback returns only after the one before it, so the parts reach the model whole and in order; a subagent's compaction gets nothing.
- `conversationRecord` in `apps/malini/src/lib/chat/platform/agent/sessions.ts` builds the record: every prompt and every reply of the chat in order, a run's replies joined, without the turns undone or rewound (`listTimelineEventRows`), the newest within 256 KB and 4,096 messages.
  It replaces `restoredConversationHistory`, so a chat whose Claude transcript is gone starts over with every message too.

## Consequences

- Long chats compact about 12 times as often, mostly during a run, and cost about 76% of what they did; the context gauge counts against 280K.
- After a compaction only tool output is left to the summary, and the agent can read it again from disk.
- A record can take up to about 90K tokens of the 280K, so a chat with a long record compacts sooner.
- A window picked with `/autocompact` or in a Claude Code settings file no longer counts in Malini; it still applies to `claude` in a terminal.
- The evaluation measured windows from 200K up, so the slider's 100K to 200K is untested.
- The record depends on Claude Code's 10,000-character cap, its newline join and its finish order: a smaller cap turns parts into file previews, and a Claude Code bump re-checks all three with the `claude-runtime` recorder, which records `SessionStart` hooks.
- Enforced by `compaction.test.ts`, which fits the largest record the bridge accepts into 48 parts, `session.test.ts` ("puts every message Malini kept back after a compaction, in order, in parts Claude Code keeps whole", "compacts at the window Malini sends, and starts a fresh Claude Code when it changes"), `sessions.test.ts`, `src/contract/agent.test.ts`, the protocol tests of both sides, `tests/e2e/compact.spec.ts`, whose second test puts the record back without an undone turn, and `tests/e2e/settings.spec.ts` ("Settings → Models sets the window every chat compacts at, 280K until the user moves it").
