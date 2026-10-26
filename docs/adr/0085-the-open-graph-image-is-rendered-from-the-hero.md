# 0085 - The Open Graph image is rendered from the hero

Status: accepted

## Context

0032 made `apps/site/static/og.png` a render of the landing page's mock-up hero, drawn once and never again.
Nothing noticed when it drifted: 0034 replaced the mock-up with `.github/readme/hero.webp` and the copy changed, yet every shared link to bestboy.dev/malini still showed the eyebrow "Free and open source, for the Mac", the headline "You had one job. / Now you have plenty." and the `acme/web` mock-up of the initial commit.
Every Bestboy site now follows one rule for its Open Graph image, applied at once in bestboyhq/platform, tony, grip and malini: the page's hero cropped to 1200x630 in the dark theme, rendered from the hero's own components, guarded by a failing check, and served from a URL that changes with its content.
Facebook, X, LinkedIn and Slack cache an image by its URL, so a new image under the old URL may never reach them.
Everything else in 0032 still holds: hydration and client navigation, server-only loads, the hover and viewport preloads, and the Worker's cache headers.

## Decision

- `apps/site/src/lib/Hero.svelte` is the landing page's hero: the eyebrow, the headline with its quiet line, and the plate with the Glow over `hero.webp`.
  The landing page passes its lede, buttons and fine print in as children.
- `src/routes/og/+page.svelte` renders `<Hero og />`: no children, no entrance animation, 16px less space above the eyebrow, the dark theme pinned with `color-scheme`, and no scrollbar.
  It is prerendered with `noindex` and no canonical, and the sitemap never lists it.
- The root layout carries only the fonts, `app.css` and the Inter preload.
  The bar, footer, skip link and Logdash moved to `src/routes/(site)/+layout.svelte` around every other page, so the view loads nothing the card does not show.
- `pnpm --filter @malini/site generate:og-image` builds the site and runs `scripts/og-image.ts` in Electron, the browser the repository already ships; `electron` moved to the pnpm catalog, shared by the app and the site.
  The script serves the build to an offscreen 1200x630 window at scale 1 behind an intercepted `https://bestboy.dev`, waits for fonts, images and every canvas to draw, keeps the frame once two captures match, and writes `src/lib/og.png` and `src/lib/og-source.sha256`.
- The source hash covers the view's HTML without its boot scripts and every file the view loads: its stylesheets and the fonts they name, its images, and the JavaScript of its own nodes and chunks.
  SvelteKit's entries, its root error page and their imports are left out, and hashed file names and the build version are blanked, so only what the card shows moves the hash.
  The script fails when the view loads a file the hash does not cover.
- `compilerOptions.rootDir` in `svelte.config.js` is the repository root, so Svelte names components outside `apps/site`, such as hyper-ui's icons, the same on every machine, and the hash computed on a Mac matches CI's on Linux.
- `src/lib/Head.svelte` imports `og.png`, so Vite serves it at `/malini/_app/immutable/assets/og.<content hash>.png`, cached for a year, and `og:image` changes whenever the image does.
  `og:image:width`, `og:image:height`, `og:image:alt` and `twitter:card` stay, and the alt describes the card.

## Consequences

- The card can no longer go stale silently.
  `apps/site/tests/site.test.ts` recomputes the source hash from the build and fails, naming the command, when the headline, eyebrow, `hero.webp`, the hero's or the Glow's code or styles, or the site tokens change.
  Edits to the rest of the landing page, the bar, the footer or the docs leave it quiet.
  CI runs it on every pull request, and the Site workflow runs it before each deploy.
- Re-capturing `hero.webp` (0034) asks for a re-render in the same pull request, and the new capture may need a new crop: the `.og` spacing puts the bottom edge between rows of today's window.
- The same hero renders the same bytes, so re-rendering without a change leaves `og.png` as it is.
  Renders are made on a Mac; Electron on Linux rasterizes text differently.
- A Svelte chunk the view shares with other pages can change when another page first uses a Svelte feature; that asks for a re-render that changes nothing visible.
- `og:image:alt` is written by hand in `Head.svelte`; the test's message asks to check it after each re-render.
- The view is public at bestboy.dev/malini/og, kept out of search by `noindex`.
