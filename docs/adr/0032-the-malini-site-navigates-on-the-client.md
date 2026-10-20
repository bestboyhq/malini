# 0032 - The Malini site navigates on the client

Status: accepted

## Context

0027 set `csr = false` on every page of `apps/site`, so the site shipped no JavaScript.
Server time was fine (110 to 350 ms to first byte), yet every docs click was a full page load that repainted the page and flashed the font.
The landing page showed the product as two README screenshots, which hold the user's real workstreams.
The goal is a site that feels as fast and as finished as logdash.io, while staying prerendered, LLMs-first and cheap to host.
Everything else in 0027 still holds: the base path, the Worker, the route split, the markdown twins, `llms.txt`, the sitemap and the SEO rules.

## Decision

- Pages hydrate and SvelteKit's client router navigates between them; `src/routes/+layout.ts` keeps `prerender = true` and drops `csr = false`.
- Content loads run on the server only (`+page.server.ts`, `+layout.server.ts`), so prerendering writes each page's data to `__data.json` and the client bundle never carries the markdown, `marked` or `shiki`.
  `src/lib/content.server.ts` is server-only by name; `SITE_URL` and the links live in `src/lib/links.ts`.
- `src/app.html` sets `data-sveltekit-preload-data="hover"`, the docs nav sets `data-sveltekit-preload-code="viewport"`, and the root layout preloads the Inter latin woff2 it uses.
- The docs nav sits in `src/routes/docs/+layout.svelte`, so it stays mounted across docs pages; after a client navigation the page heading takes focus.
  Links to raw files (`.md`, `llms.txt`, the sitemap) carry `data-sveltekit-reload`.
- The Worker sends `public, max-age=0, stale-while-revalidate=86400` for pages and `__data.json`, and keeps `public, max-age=31536000, immutable` for `/malini/_app/immutable/*`.
  A stale page is safe: the browser loaded it with its immutable chunks, which it still holds.
- The landing page draws the product with hand-built Svelte mock-ups that use invented demo data (`acme/web`, `acme/api`), and the Open Graph image `static/og.png` is a render of that mock-up.
  The site never imports `.github/readme`.

## Consequences

- Docs navigation fetches a few kilobytes of `__data.json` instead of a page, with no repaint; the client JavaScript is about 30 KB gzipped for docs pages.
- Without JavaScript every page still renders in full, since every page is prerendered HTML.
- A mock-up that should show a new feature is code in `src/lib`, not a screenshot, and must keep to invented names.
- `apps/site/tests/site.test.ts` fails when a content page lacks its prerendered HTML or `__data.json`, a page loses the hover preload or the client router, a page misses `og.png`, the Worker's page or immutable cache header changes, or any file in `apps/site` references `.github/readme`.
