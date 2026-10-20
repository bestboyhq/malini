# 0034 - Site mock-ups use the app's design system

Status: accepted

## Context

0028 drew the landing page's product shots as hand-built Svelte mock-ups with invented markup, the site's Inter font and colors copied by hand into `--app-*` tokens.
The user found them not faithful to the app: wrong font, wrong surfaces, invented layouts such as a stage checklist the merge queue never shows, and motion the app does not have.
The app renders with Tailwind 4, daisyUI themes, `@malini/hyper-ui` components and tokens, and Geist; none of that reached the site.
Static screenshots stay out: they do not move, they drift silently, and a screenshot of real data once leaked private workstreams onto the live site.
Importing the app's own presentation components is out too: they depend on `$lib` aliases, application-layer commands and queries, and the platform port, none of which exist in the site.
The hero is the exception the user chose: the README's `hero.webp`, already public, replaces 0028's hero mock-up.

## Decision

- `apps/site/src/lib/app-ui/app-ui.css` loads the app's styling stack for the mock-ups: Geist and Geist Mono, `tailwindcss/utilities.css` with `source(none)` and `@source` on `src/lib`, daisyUI with `include: properties` so only its theme colors register, and `@malini/hyper-ui/styles`.
  Mock components import it through `app-ui.api.ts` and put `class="app-ui"` on their root.
- `.app-ui` carries a preflight-equivalent reset scoped with `:where()`; Tailwind's global preflight stays off, so the docs keep their own typography.
- The site's element resets in `src/app.css` sit in `@layer base`, so Tailwind utilities inside a mock-up win over them.
- No daisyUI component classes: daisyUI's `.hero`, `.dock`, `.steps`, `.tabs` and `.label` are global and collided with the site's own class names.
- The site avoids hyper-ui's global names: its pill buttons are `.button` (hyper-ui owns `.btn`), and its easing token is `--ease-out-quart` (hyper-ui owns `--ease-out`).
- Each mock-up copies the markup, classes, copy and motion of the real components in `apps/malini/src/lib/**/presentation/`, replaces their data with a scripted timeline of invented demo data (`acme/api`, `Rate limit headers`), and follows the app's real state order.
  `QueueMock`, `BrowserMock`, `MergeQueueMock` and `RoutineMock` follow this; `TerminalMock` and the CTA panel are site chrome, not app UI, and keep the site's own `--app-*` tokens.
- Reference captures of the real app come from the e2e harness with its fake bridge and demo data, never from a user's profile.
- The hero is `.github/readme/hero.webp`; it is the only README image the site uses.

## Consequences

- A mock-up looks like the app by construction: same font, tokens, components and density, in light and dark.
- When the app's UI changes, a mock-up does not follow on its own; its markup is a copy and drifts until someone recopies it.
- The landing page carries the app's CSS, about 24 KB gzipped, loaded only by the landing page's chunk.
- A new site class name must not equal a hyper-ui global class or a daisyUI component name, or it picks up their rules.
- `apps/site/tests/site.test.ts` fails when the site uses a README image other than the hero.
  `@malini/desktop/domain-boundaries` fails when a file imports `app-ui.css` past `app-ui.api.ts`.
  Nothing enforces that a mock-up copies the real components or that daisyUI components stay off; review against the reference captures does.
