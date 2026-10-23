# 0043 - The site counts visits and downloads with Logdash

Status: superseded by 0059

## Context

bestboy.dev already counts visits and downloads with Logdash web analytics, through its own `/_ld/` routes, while the Malini site counted nothing.
Its Download buttons are plain links to the dmg on GitHub, so a Malini download from the site left no record beyond GitHub's per-file total.
The user wants the Malini landing in the same analytics, with its traffic plainly the Malini landing's and never mistaken for bestboy.dev's root page.
The site's own Worker owns `bestboy.dev/malini*` and deploys apart from bestboy.dev (0031), so it should not lean on bestboy.dev's routes.

## Decision

- The Worker (`apps/site/worker/index.ts`) passes Logdash through this origin, so blockers of Logdash's hosts leave it alone:
  - `/malini/_ld/script.js` is `https://logdash.io/sdk/web.js`, cached for an hour at the edge and in the browser.
  - `/malini/_ld/events` forwards a batch to `https://api.logdash.io/web_events` with the visitor's Origin, User-Agent and address (`X-Logdash-Client-IP`), and nothing else of theirs.
  - It refuses a batch that is not JSON (415), is over 32 kB (413), names another Logdash site, holds 0 or more than 20 events, or holds an event whose path is not under `/malini` (400).
- The site reports to bestboy.dev's Logdash site; its ID lives once in `apps/site/src/lib/logdash.ts`, read by the Worker, the layout and the tests.
  The Worker's entry module exports only its handler, since the Workers runtime refuses any other export.
- `src/routes/+layout.svelte` loads the script in production builds only, so `vite dev` neither 404s nor reports.
- One click listener on the document, in the same layout, tracks `download_started` with `{ app: 'malini', menu: 'malini-<place>' }`.
  The place is the nearest `data-place`: `bar`, `hero`, `closing`, `footer` or `docs`, and `page` when none.
  bestboy.dev's own Download menus send `get-bar` and `get-hero` from the root path, so the two never mix.

## Consequences

- Malini's pages show in bestboy.dev's Logdash under `/malini` paths, and its downloads under `malini-*` menus, next to bestboy.dev's own.
- The site still sets no cookie (0031): the script only expires its own legacy cookies, and reads an opt-out flag from `localStorage`.
- Logdash skips automated browsers (`navigator.webdriver`), so Playwright and agent runs never report; a check that wants it running launches Chrome with `--disable-blink-features=AutomationControlled`.
- A new link to the dmg is tracked with no extra code, but only names its place when it sits inside a `data-place` region; nothing enforces that.
- `apps/site/tests/site.test.ts` fails when a page stops loading the script from `/malini/_ld/` with the shared site ID, or when the Worker forwards a batch it should refuse.
