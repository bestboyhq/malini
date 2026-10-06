---
name: test-malini-app
description: Verify a malini change in the real Electron app and capture native evidence. Use for native validation, reproducing a bug end to end, and screenshots of the app window.
---

# Test the malini app

Native validation means the real platform and real data in the built app: the user's own `claude` login, real repositories, a native screenshot of malini's window, and a clean console.
Automated tiers with fakes (`tests/e2e`, vitest) are a different job; their rules live in `.agents/rules/frontend/testing.mdc`.

## Build what you run

```sh
corepack pnpm --filter @malini/agent-bridge build
corepack pnpm --filter malini build
```

The launcher runs `apps/malini/out/` and the bridge from `packages/agent-bridge/dist/`, never the sources.
Rebuild after every source change, or the screenshot shows the old code.

## Use a sandboxed profile

The live profile is `~/Library/Application Support/malini`; `pnpm dev` and the installed app both write there.
Every run gets its own profile under `.context/profile-<topic>/`.
The single-instance lock is per profile, so the sandbox runs beside the user's own malini.
The real `HOME` stays, so the bridge reaches the user's `claude` login and git config.

Add real repositories through the app's own UI in the sandbox.
When the bug needs existing history, snapshot the live database before the first launch:

```sh
mkdir -p .context/profile-<topic>
sqlite3 ~/Library/Application\ Support/malini/malini.sqlite ".backup '.context/profile-<topic>/malini.sqlite'"
```

The snapshot's workstream and repository paths still point into the live profile.
Read those workstreams; send prompts, commit, and push only in workstreams created inside the sandbox.

## Drive and capture

`scripts/malini.mjs` exports `launch(topic, { foreground })`.
It returns the Playwright `page`, the Electron `app`, `errors` (console and page errors), `shot(name)`, and `close()`.
`shot` waits for transitions to settle, then captures malini's own window with `screencapture -l` into `.context/<name>.png`.

Write the flow as a script under `.context/` and run it with `node`:

```js
import { launch } from '../.agents/skills/test-malini-app/scripts/malini.mjs';

const malini = await launch('model-picker');
try {
	await malini.page.getByRole('button', { name: /^Model: / }).click();
	await malini.shot('model-picker-open');
} finally {
	console.log(malini.errors);
	await malini.close();
}
```

Locate by role and accessible name, and wait on the state the user would see, never on a timeout.
Playwright's `click()` may scroll the transcript to reach its target, which unpins it the way a user scrolling up would; when the flow depends on scroll position, click at the target's box with `page.mouse.click`.

The window runs in the background by default: it sits behind every other app with one pixel on screen, never takes focus or clicks, and `screencapture -l` still captures all of it.
The user keeps working while you test.
Pass `{ foreground: true }` only when the user asks to watch.

## Done

- Every state the change touches has a screenshot, and you have read each one back.
  Inspect it like a picky designer: clipping, alignment, overflow, truncation, stray scrollbars, wrong copy.
  Fix what looks off, even when it is not yours.
- `errors` is empty for the interaction.
- The screenshots are embedded in your final reply.
- Every app you launched is closed.
  Stop only the processes you started, by their PID; a pattern kill takes the user's own malini down with yours.
