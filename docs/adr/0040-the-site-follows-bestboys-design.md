# 0040 - The site follows Bestboy's design

Status: accepted

## Context

bestboy.dev, bestboy.dev/malini and the sites after them are one family, and the user asked to rebuild Malini's site according to bestboy.dev's design document.
That document is `docs/design.md` in the private `bestboyhq/platform` repository; it says each site copies its values and that a change lands there first, then in each site by hand.
Its "Bringing a site in step" section lists what Malini's site lacked: the shared tokens, JetBrains Mono, crosses on every beat line, numbered labels, the Product and Resources menus, a footer with a theme switcher, the macOS icon marks, elevated secondary buttons, and the FAQ head at the block size.
The site followed the system's color scheme only, through `prefers-color-scheme`, so a visitor could not choose a theme.
0034 keeps the site's names off hyper-ui's globals, since the mock-ups load hyper-ui's CSS onto the landing page and it stays loaded after a client navigation (0032).

## Decision

- `apps/site` copies the design document's tokens, frame, bar, footer and components; the document is the source, and a change to it reaches the site by hand.
- Tokens live once in `src/app.css` as `light-dark()` pairs; `:root` declares `color-scheme: light dark`, and `data-theme="light"` or `"dark"` on `<html>` pins one.
  hyper-ui's daisyUI themes key off the same attribute, so the mock-ups follow the choice too.
- The footer's `ThemeSwitcher.svelte` offers light, system and dark, stores the choice in `localStorage.theme`, and an inline script in `src/app.html` applies it, and the matching `theme-color`, before the first paint.
- `Bar.svelte` carries bestboy.dev's own Product and Resources menus, the same on every Bestboy site at the user's request, so a visitor finds one menu wherever they land; only the brand path (Bestboy / Malini), a Docs link, GitHub and Download are Malini's.
  `Footer.svelte` (the sitemap on product pages, the last line alone on the 404) and `BeatLabel.svelte` (`01 / 11  Kicker`) take their links from `src/lib/links.ts`.
- The hero's light is bestboy.dev's `Glow.svelte` (WebGL with grain, over a CSS fallback): the painting rises behind the top of the window on a `--panel` plate and grows in last, at bestboy.dev's `--pace` of 1.4, as the plate's beat line draws its seam; the stage light stays on the feature rows only.
- `.site` draws the rails, `.beat` the beat line with its crosses, and `.wrap` the 1200px column.
- The landing page moves as bestboy.dev's does: on load the rails and the bar's line draw in from the window's top-left corner, so the rails ride the window there.
  Below the hero, each beat's line draws across and its `.rise` pieces blur in once as they scroll into view; the page's script marks what waits.
  The keyframes are `blur-in`, `fade-in` and `draw-in`, since hyper-ui owns a global `fade`.
- JetBrains Mono is self-hosted from `src/lib/fonts` as `--mono`; Inter keeps fontsource with a metric-matched `Inter Fallback`; the marks are the macOS icons in `static/icons`, drawn with `.app-icon`.
- The site's easing token is `--ease`, `cubic-bezier(0.22, 1, 0.36, 1)`, since hyper-ui owns `--ease-out`; this replaces 0034's `--ease-out-quart`.
- Colors the stage light's canvas needs are read from computed `color` and `border-top-color`, since `getPropertyValue` returns an unresolved `light-dark()`.
- The questions' "Ask AI" row is left out: it needs a Workers AI binding and a rate limiter on the `malini-site` Worker, a paid public endpoint the user has not approved.

## Consequences

- The two sites read as one family, and a visitor's theme choice holds across bestboy.dev and bestboy.dev/malini, which share an origin and `localStorage.theme`.
- The site now depends on a document in another repository; nothing flags drift between the two, so a design change needs a pull request in each.
- A new color is a `light-dark()` pair in `src/app.css`, never a `prefers-color-scheme` block, or the theme switcher stops reaching it.
- `apps/site/tests/menu.test.ts` fails when the menus' easing leaves the site curve; `site.test.ts` still guards 0031 and 0032; `pnpm check` and `eslint` (no comments, no casts, no background transitions) cover the copied components.
  Nothing enforces that the site matches the design document; review side by side at 390px and 1280px in light and dark does.
