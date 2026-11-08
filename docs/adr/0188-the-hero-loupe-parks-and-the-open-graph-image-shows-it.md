# 0188 - The hero loupe parks, and the Open Graph image shows it

Status: accepted

## Context

0176 put Malini over your Claude Code under a loupe in the hero, and kept `hero.webp` in the Open Graph view.
The user found three faults after it shipped: "we didnt regenerate our OG", "hero loupe is wild, and sometimes feels like 'bubbling' upwards, super weird feeling movements", and "im sometimes getting light theme app in hero section; only after another reload it goes dark".
The loupe followed each lit line up its feed: every step it parked, rose at 25 to 35 px/s for two seconds, then dropped to the next step, and it crossed the stage at up to 1730 px/s.
The lit lines reached it by a boost that raced a column up by up to two thirds of the stage, and only the loupe shows the feeds, so that race filled the glass.
`og.png` carried the new headline over the old window, because the view rendered `hero.webp`, not the hero.
The light app came from the eager hero iframe: before the site's stylesheet applies, the frame's `prefers-color-scheme` is light, `theme-boot.js` can read it then, and the app listened for the flip to dark only once its bundle booted; 1 of 10 cold loads of bestboy.dev/malini stayed light.

## Decision

- This replaces 0176's motion and its Open Graph line; the rest of 0176 holds: the headline, the three layers, `?play=setup`, the rows the demo posts, the loupe's size and the narrow stage.
- `apps/site/src/lib/loupe.ts` writes a step's lines into the rows where the loupe will rest, and stops that column; the other columns keep crawling at 7 to 11 px/s and ease back to it in 1.2 s once they lose the step.
  When the loupe already shows that spot, the lines go in just under its edge, and the column lifts them into the centre in 1.6 s on a smoothstep.
  The loupe glides from where it is to the step's spot on a 1.8 s smoothstep under the spring of stiffness 40, and rests there until the next step, 4.8 s after the last.
  A lit line glows at full until the loupe arrives, then settles over 2.4 s.
- It follows the pointer on that spring alone, with no lead.
- `SetupLoupe.svelte` places the six steps at 30, 34, 70, 34, 20 and 66% of the stage height, so two steps in a row in one column sit at least a third of the stage apart, and the CLAUDE.md step, the resting one, sits at the top of the sidebar.
  The stage is `aria-busy` until the app's rows arrive.
- `src/routes/og/+page.svelte` still renders `<Hero og />`, and the hero now always renders `SetupLoupe.svelte`; `Hero.svelte` no longer imports `hero.webp`.
- `apps/site/scripts/og-image.ts` runs Electron with `force-prefers-reduced-motion`, so the view is the hero's still frame on the CLAUDE.md step, and it waits until no element is `aria-busy` before it looks for a settled frame.
  It leaves `/malini/demo/` out of the files the source hash must cover, so the hash narrows 0087's: the view's own code and styles move it, and the app inside the frame does not.
- `watchSystemTheme` in `$lib/app/infrastructure/services/appearance-document.service.ts` reports the current `prefers-color-scheme` as it subscribes, so a flip between `theme-boot.js` and boot reaches the theme.

## Consequences

- The loupe moves only between steps, and nothing slides under it while it rests.
  Narrow stages park every step in one spot, so there each step lifts its lines in from below.
- Social cards show the hero people land on, and the card's app is whatever the demo build draws at the last render.
  A renderer change leaves `apps/site/tests/site.test.ts` quiet; a change to the hero, the loupe or their styles fails it until `pnpm --filter @malini/site generate:og-image` re-renders.
- `og:image:alt` in `Head.svelte` describes the loupe card and is still written by hand.
- The Open Graph render needs WebGL2 in Electron's offscreen window, or the card shows the CSS lens ring.
- The hero app is hidden until its rows arrive, so its first light frame never shows; the Electron app reads the same value it already had and changes nothing.
- Nothing tests the loupe's motion or the theme race; the timing that set the theme wrong needs the site's stylesheet late and the demo's boot script early.
