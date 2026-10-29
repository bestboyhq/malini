# 0108 - The landing page runs the real renderer on demo data

Status: accepted

## Context

0034 kept the app's presentation components out of the site, because they depend on `$lib` aliases, application-layer commands and queries, and the platform port, and made the README's `hero.webp` the hero.
The user read the landing page and could not tell what makes Malini different: a screenshot and hand-copied mock-ups showed a chat, a queue and a job, things every agent app has.
They asked for the actual interface in the hero, since the site and the app share one repository, and for cards that show what only Malini does: reports instead of walls of text, the before and after, and variants.
They then asked for the hero to play a script on the real repositories, an organization chat that starts workstreams across them, and for media that looks like real work instead of mock-ups.
The renderer reaches the platform only through `window.malini`, its `invoke` and `on` (0002), so a browser that answers those two from demo data runs the real app with no Electron.
The mock-ups drift every time the app changes; the real renderer cannot.

## Decision

- `apps/malini/src/renderer/demo/` is a second renderer entry beside `src/renderer/src`.
  `demo-bridge.ts` builds a `window.malini` from a handler per `CommandName`, typed by `$contract`, and an `EventTarget` for `on`; a command with no handler rejects with "The demo shows Malini on made-up data. Download Malini to do this."
  `demo-data.ts` holds the demo: the real `bestboyhq` repositories (malini, platform, grip, tony), three workstreams whose transcripts are `AgentEvent`s ending in reports, the organization chat's run and the three workstreams it starts.
  `demo-live.ts` keeps the state that changes: the workstream list, session statuses and transcripts, and shipping; it creates an organization chat for `repositories.create-lead`, plays that chat's run when it gets the scripted prompt, streams a short reply to any other prompt, and answers Draft and Merge.
  The media are real: Grip's captions recording from its site, Tony's real hero as the before, and Open Graph directions drawn from the real app icons and screenshots, as WebP and MP4 files in `media/`.
- `app.html` mounts the whole `App` and draws the macOS traffic lights the native window would.
  With `?play=hero`, `demo-script.ts` drives it like a person in about twenty seconds: the hero opens on a new chat in bestboyhq with the prompt already in the composer, a drawn cursor sends it, and the chat starts a workstream in malini, grip, tony and platform that nest under it.
  Once the last one shows, without waiting for their work, the cursor opens Tony's hero before and after, wipes it and presses Merge, then returns to the chat as it reports three directions and steps through them while Tony's pull request merges in the sidebar.
  The cursor glides on a curved, minimum-jerk path.
  A real click or key press stops the script, and reduced motion skips it.
- `card.html` mounts `TurnReportCard` alone for the workstream named in its hash, scaled to fit its frame.
  `?play=work` shows the prompt and the tool calls arriving with a running clock, then the report; `?play=sweep` sweeps the before and after wipe; `?play=cycle` steps through the variants.
  Each plays while most of the card is in view and, except `work`, stops at the first touch.
  Both mute sounds through `app.list-settings`, and both pass a wheel turn that nothing inside can scroll to the page around them.
- `apps/malini/vite.demo.config.ts` merges the electron-vite renderer config without its font preload, which warns in an iframe still out of view, aliases `$contract/workstream-images` to `demo-workstream-images.ts` so report images load from the bundle instead of the `malini-image:` protocol, and builds both pages into `apps/site/static/demo/`, which git ignores.
  `pnpm --filter malini build:demo` builds it, `dev:demo` serves it, and the site's `dev` and `build` scripts build it first.
- The site embeds the pages as iframes: `Hero.svelte` shows `app` with `?play=hero` at 1280 by 860 scaled to the column, interactive above 640px wide; `DemoCard.svelte` shows `card` in the Reports (`work`), Before and after (`sweep`) and Experiments (`cycle`) rows.
  `demoHref` in `links.ts` names `/malini/demo/app` in production and `app.html` under `vite dev`.
  Prerender skips exactly `/malini/demo/app` and `/malini/demo/card`, the Worker caches `/malini/demo/assets/` for a year, and the Site workflow also deploys when `apps/malini`, `packages` or `extensions` change.
- `<Hero og />` keeps `hero.webp`, so the Open Graph image and its source hash (0087) stay independent of the app.
- `QueueMock`, `JobMock`, `TerminalMock` and the landing page's server load are gone; `BrowserMock` and `MergeQueueMock` stay mock-ups and keep 0034's `app-ui.css` rules.

## Consequences

- The hero and the report cards are the app as it is on `main`, in light and dark: a visitor watches an organization chat work across four repositories, then can click through workstreams, wipe a before and after, pick a variant and send a prompt.
- The script finds the app's elements by test id and accessible name, so renaming `chat-composer-input`, `chat-composer-submit`, `sidebar-chat`, a sidebar row's `data-workstream-id` or "New chat in" stalls the hero at that step.
- Every app change redeploys the site, and a renderer change can break the demo: a new command the boot path needs has no handler and rejects.
  `pnpm check` fails when a handler's shape drifts from `$contract`; nothing fails when a new boot command is missing, so check the demo's console after changing what the app loads at start.
- The demo's main chunk is about 900 KB gzipped, loaded by the hero's iframe and shared by the cards from cache.
- `apps/site/tests/site.test.ts` fails when the landing page stops embedding `app` and `card` or the build misses either page, and its Worker test covers the demo's cache headers.
- The demo writes the app's `malini.*` keys into the site's local storage, as the app does in its own window.
