# 0305 - Every agent call carries less

Status: accepted

## Context

The user asked where Malini spends tokens it does not need to.
A scan of 7 days of transcripts, about 31,700 model calls, found cache reads at 58% of the cost: each call reads its whole context again, and the median call carries 147k tokens.
A main chat starts at about 67k tokens before any work, and a subagent at about 44k.
Part of that start was waste: the bridge appended the worktree's `AGENTS.md` to the system prompt while Claude Code 2.1.331 already loads it from `settingSources`, and `alwaysLoad: true` on the `malini` server sent all 33 tool schemas with every call, though most chats use a handful.
A browser screenshot reached the model as a JPEG preview of the Retina capture, up to 1,568 pixels on its long edge, so a 531-pixel-wide tab reached it at 1062×1250, twice the page's own size, and a `shot` from the test-malini-app skill was a 2560×1600 Retina capture that costs about 2,700 tokens each time an agent reads it.
98% of the 1,972 sandbox reports in the scan came after commands that worked, most repeating a block the chat had already heard; 0280 removed the harmless lines, but not the repeats.
A report after a command that worked still matters: some commands failed in silence behind a pipe or a script, such as a `mkdir` refused inside a script and an Electron run masked by `| tail`.

## Decision

- `systemPromptAppend` in `packages/agent-bridge/src/claude/instructions.ts` no longer reads `AGENTS.md` and takes no `cwd`; Claude Code loads it.
- `maliniTools` in `browser-tools.ts` drops the server-level `alwaysLoad` and passes `{ alwaysLoad: true }` to `tool()` only for `browser_open`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_wait`, `browser_evaluate`, `browser_console`, `browser_reload`, `browser_resize` and `browser_close`.
  Every other tool, the platform tools included, loads through Claude Code's tool search the first time the agent reaches for it.
- The `<malini>` block no longer repeats what a deferred tool's own description says: the browser bullet names only `browser_snapshot` refs, and the automation, widget, secrets, workstream and subagent bullets keep the rule and drop the tool manual.
- `saveScreenshot` in `apps/malini/src/lib/browser/platform/automation.ts` scales the preview to the CSS width of what it captured, the viewport's `clientWidth` from `Page.getLayoutMetrics` or the clip of a page or element, and caps it at `PREVIEW_LONG_EDGE`, now 1,280; the PNG the agent embeds keeps every pixel.
- `shot` in `.agents/skills/test-malini-app/scripts/malini.mjs` resizes the capture to the window's content width, so it saves at 1x.
- `#reportBlocked` in `session.ts` keeps the blocks each agent of a chat has heard, keyed by agent, process, operation and target with digits folded, and after a command that worked reports only blocks that agent has not heard; after a failed command it reports every block, and compaction forgets what was told.

This amends 0191, 0234 and 0280.

## Consequences

A chat starts smaller and every later call reads less again, with the most gain in long chats and in subagents.
An agent that needs a deferred tool spends one tool search call to load it, so a tool that turns out to be in most chats belongs in the always-loaded list.
The model sees screenshots at the size a user sees the page, not at Retina detail; a fine detail needs `browser_screenshot` with a `selector`, or a Read of the full PNG the tool returns.
A block an agent heard once is not repeated after commands that work, so a silent failure from the same block shows only in the command's own output.
`browser-tools.test.ts` fails when the always-loaded list changes, `session.test.ts` fails when a repeated block is told again after a command that worked or held back after one that failed, `instructions.test.ts` fails when a kept rule leaves the block, and `views.test.ts` fails when a preview is larger than the page's CSS size.
