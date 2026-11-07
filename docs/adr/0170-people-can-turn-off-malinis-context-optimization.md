# 0170 - People can turn off Malini's context optimization

Status: accepted

## Context

ADR 0145 put Malini in charge of every chat's context: it sets the window Claude Code compacts at, 280K unless moved, over any `/autocompact` pick, and puts every message it kept back right after each compaction.
That is the right default, since "most people won't even know that there is an option like that".
The user then asked for a way out: "Malini will just do that for you, but it should be an option. Some ppl will want us not to do anything with their context window and we should let them".
The slider alone cannot do that, because every position still overrides the user's Claude Code settings and still puts the record back.

## Decision

- **Settings → Models → Optimize context** is a switch, on until turned off, saved as `chat.optimize-context` in the settings table, `off` when off.
  `optimizesContext` in `src/contract/agent.ts` reads it: anything but `off` is on.
- The switch sits on the Context window card in `ContextWindowSettings.svelte`, and the slider hides while it is off.
- Off, the `compactWindow` hook in `src/lib/chat/platform/agent/service.ts` returns `null`, so `send_prompt` carries no `compactWindow` and the bridge passes no `autoCompactWindow`: Claude Code compacts at its own window, or at the one `/autocompact`, a Claude Code settings file or `CLAUDE_CODE_AUTO_COMPACT_WINDOW` picks.
- Off, main answers `bridge.history_request` with no messages, so the `SessionStart:compact` hooks add nothing and the agent keeps only Claude Code's summary.
- The bridge and protocol stay as they are.
  A chat whose Claude transcript is gone still starts over with every message Malini kept, because that is recovery, not optimization.

## Consequences

- Turning the switch either way gives the chat's next prompt a fresh Claude Code, as moving the slider does, because its window changes.
- `/autocompact` stays out of the slash menu; with the switch off, people pick a window in their Claude Code settings.
- A chat that compacts with the switch off loses what ADR 0145's evaluation measured: recall falls back toward 70% after one compaction.
- Enforced by `tests/e2e/compact.spec.ts` ("with Optimize context off, a chat compacts at its own window and gets nothing put back"), which turns the switch off in Settings and checks that the chat gets no window and no record.
