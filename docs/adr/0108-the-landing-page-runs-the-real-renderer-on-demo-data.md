# 0108 - The landing page runs the real renderer on demo data

Status: accepted

## Context

0034 kept the app's presentation components out of the site, because they depend on `$lib` aliases, application-layer commands and queries, and the platform port, and made the README's `hero.webp` the hero.
The user read the landing page and could not tell what makes Malini different: a screenshot and hand-copied mock-ups showed a chat, a queue and a job, things every agent app has.
They asked for the actual interface in the hero, since the site and the app share one repository, and for cards that show what only Malini does: reports instead of walls of text, the before and after, and variants.
The renderer reaches the platform only through `window.malini`, its `invoke` and `on` (0002), so a browser that answers those two from demo data runs the real app with no Electron.
The mock-ups drift every time the app changes; the real renderer cannot.

## Decision

- `apps/malini/src/renderer/demo/` is a second renderer entry beside `src/renderer/src`.
  `demo-bridge.ts` builds a `window.malini` from a handler per `CommandName`, typed by `$contract`, and an `EventTarget` for `on`; a command with no handler rejects with "The demo shows Malini on made-up data. Download Malini to do this."
  `demo-data.ts` holds the demo: the `acme/web` and `acme/api` repositories, four workstreams, their transcripts as `AgentEvent`s ending in reports, and the shipping state; `demo-live.ts` streams a scripted reply to a sent prompt and answers Draft and Merge.
  The media the reports show are WebP files in `media/`.
- `app.html` mounts the whole `App` and draws the macOS traffic lights the native window would; `card.html` mounts `TurnReportCard` alone for the workstream named in its hash, with earlier turns, scaled to fit its frame.
  Both mute sounds through `app.list-settings`, and both pass a wheel turn that nothing inside can scroll to the page around them.
- `apps/malini/vite.demo.config.ts` merges the electron-vite renderer config, aliases `$contract/workstream-images` to `demo-workstream-images.ts` so report images load from the bundle instead of the `malini-image:` protocol, and builds both pages into `apps/site/static/demo/`, which git ignores.
  `pnpm --filter malini build:demo` builds it, `dev:demo` serves it, and the site's `dev` and `build` scripts build it first.
- The site embeds the pages as iframes: `Hero.svelte` shows `app` at 1280 by 860 scaled to the column, interactive above 640px wide; `DemoCard.svelte` shows `card` in the Reports, Before and after, and Variants rows.
  `demoHref` in `links.ts` names `/malini/demo/app` in production and `app.html` under `vite dev`.
  Prerender skips exactly `/malini/demo/app` and `/malini/demo/card`, the Worker caches `/malini/demo/assets/` for a year, and the Site workflow also deploys when `apps/malini`, `packages` or `extensions` change.
- `<Hero og />` keeps `hero.webp`, so the Open Graph image and its source hash (0087) stay independent of the app.
- `QueueMock`, `JobMock`, `TerminalMock` and the landing page's server load are gone; `BrowserMock` and `MergeQueueMock` stay mock-ups and keep 0034's `app-ui.css` rules.

## Consequences

- The hero and the report cards are the app as it is on `main`, in light and dark, and a visitor can click through workstreams, wipe a before and after, pick a variant and send a prompt.
- Every app change redeploys the site, and a renderer change can break the demo: a new command the boot path needs has no handler and rejects.
  `pnpm check` fails when a handler's shape drifts from `$contract`; nothing fails when a new boot command is missing, so check the demo's console after changing what the app loads at start.
- The demo's main chunk is about 900 KB gzipped, loaded by the hero's iframe and shared by the cards from cache.
- `apps/site/tests/site.test.ts` fails when the landing page stops embedding `app` and `card` or the build misses either page, and its Worker test covers the demo's cache headers.
- The demo writes the app's `malini.*` keys into the site's local storage, as the app does in its own window.
