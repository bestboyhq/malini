---
name: test-malini-app
description: Verify a Malini change in the real Electron app and capture native evidence. Use for native validation, reproducing a bug end to end, and screenshots of the app window.
---

# Test the Malini app

Native validation means the real platform and real data in the built app: the user's own `claude` login, real repositories, a native screenshot of Malini's window, and a clean console.
Automated tiers with fakes (`tests/e2e`, vitest) are a different job; their rules live in `.agents/rules/frontend/testing.mdc`.

A screenshot of real data is evidence for the chat only: the user's repositories, workstreams, prompts and accounts are private.
Never put one in the README, `docs/`, `.github/readme/`, `apps/site`, or anything else that ships or gets published.
Product images come only from a sandbox profile whose repositories, workstreams and prompts are a throwaway demo made for that image.

## Build what you run

```sh
corepack pnpm build
```

The launcher runs `apps/malini/out/` and the bridge from `packages/agent-bridge/dist/`, never the sources, and the app build needs every workspace package built first.
After that, rebuild what you changed (`corepack pnpm --filter malini build` for the app), or the screenshot shows the old code.

## Use a sandboxed profile

The live profile is `~/Library/Application Support/malini`; `pnpm dev` and the installed app both write there.
Every run gets its own profile outside the worktree, at `$P` below, which is where `launch(topic)` points the app.
The single-instance lock is per profile, so the sandbox runs beside the user's own Malini.
The real `HOME` stays, so the bridge reaches the user's `claude` login and git config.

Add real repositories through the app's own UI in the sandbox.
When the bug needs existing history, snapshot the live database before the first launch:

```sh
P=$(realpath "${TMPDIR:-/tmp}")/malini-profile-<topic>; mkdir -p "$P"
sqlite3 ~/Library/Application\ Support/malini/malini.sqlite ".backup '$P/malini.sqlite'"
```

The app looks for workstream checkouts inside the sandbox profile, so the snapshot alone shows every workstream without its checkout.
Copy the checkouts in too and repoint their git metadata at the copies.
Skip each workstream's `.context` and `node_modules`: the sandbox needs neither, and copying them once grew a profile to 1.5 million files.

```sh
L=~/Library/Application\ Support/malini
cp -cR "$L/repositories" "$P/"
mkdir -p "$P/workstreams"
for ws in "$L"/workstreams/*/; do
	rsync -a --exclude=.context --exclude=node_modules "$ws" "$P/workstreams/$(basename "$ws")/"
done
for ws in "$P"/workstreams/*/; do
	g=$(sed 's/^gitdir: //' "$ws.git"); ng="${g/$L/$P}"
	echo "gitdir: $ng" > "$ws.git"; echo "${ws}.git" > "$ng/gitdir"
done
sqlite3 "$P/malini.sqlite" "update projects set repo_path = replace(repo_path, '$L', '$P');
	update workstreams set path = replace(path, '$L', '$P');
	delete from workstream_ship;"
for repo in "$P"/repositories/*/base; do
	git -C "$repo" config url."https://sandbox-never-pushes.invalid/".pushInsteadOf https://github.com/
done
```

Rewrite those paths before the first launch: `projects.repo_path` is absolute, and a new workstream otherwise branches off the user's live repository.
Empty the merge queue too: a snapshot keeps the user's queued pull requests, and the sandbox would mark them ready, push to them and merge them on GitHub.

Block pushes from the copies: each copy tracks the user's real branch on GitHub, so a **Draft**, a **Merge** or an agent's push from a copy lands there.
The `pushInsteadOf` rewrite sends every push from the copies to an unreachable host, while fetches still reach GitHub.
Send prompts and commit only in workstreams created inside the sandbox; a flow that has to push unsets the rewrite for that run.

## Drive and capture

`scripts/malini.mjs` exports `launch(topic, { foreground })`.
It returns the Playwright `page`, the Electron `app`, `errors` (console and page errors), `shot(name)`, and `close()`.
`shot` waits for transitions to settle, then captures Malini's own window with `screencapture -l` into `.context/<name>.png`.

Write the flow as `$P/flow.mjs`, importing the launcher by its absolute path, and run it with `node`:

```js
import { launch } from '<worktree>/.agents/skills/test-malini-app/scripts/malini.mjs';

const malini = await launch('model-picker');
try {
	await malini.page.getByRole('button', { name: /^Model: / }).click();
	await malini.shot('model-picker-open');
} finally {
	console.log(malini.errors);
	await malini.close();
}
```

The window shows the theme the user is in: `launch` reads `MALINI_THEME`, which Malini sets for its agents, and follows the system without it.

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
  Stop only the processes you started, by their PID; a pattern kill takes the user's own Malini down with yours.
- The profile you made is removed: `rm -rf "$P"`.
