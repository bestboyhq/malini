# 0260 - The README hero is recorded from the site's hero

Status: accepted

## Context

0034 made the README's `hero.webp` the landing page's hero, so both showed one picture.
0176 and 0188 replaced that picture on the site with `SetupLoupe.svelte`: the demo renderer under a WebGL glass loupe that magnifies your Claude Code setup.
The README kept a still of a demo-renderer scene, shot by `apps/malini/scripts/readme-hero.mjs`, so GitHub showed a different product shot than bestboy.dev/malini.
The user asked for the README to show the loupe from the landing page hero.
A screen recording of the live page drifts with the machine's frame rate and cuts the loop at a random step.

## Decision

- `apps/site/scripts/readme-hero.ts` records the README hero; `pnpm --filter @malini/site generate:readme-hero` builds the site and runs it in Electron.
  `apps/malini/scripts/readme-hero.mjs` and its `generate:readme-hero` script are gone.
- An offscreen `BrowserWindow` at 1280 by 1100 CSS px and a device scale of 1.5 loads `https://bestboy.dev/malini`, which a protocol handler serves from `apps/site/build`, and captures only the hero's plate.
- A script in the page's head replaces `requestAnimationFrame` and `performance.now` with a virtual clock that steps 40 ms per frame, and pins every infinite CSS animation to that clock, so every run gives the same frames.
- The loop starts on the loupe at rest over `~/.claude/CLAUDE.md`, glides three steps, and clicks the stage to bring the loupe back to rest; its last 20 frames blend into its first.
- `img2webp` writes an animated WebP at quality 78, with the first frame, the last and each frame where the motion stops at quality 97.
  `hold` keeps each 8 px block of the frame shown before until the encoder would show it change, so parts that do not move do not shimmer.
- The dark theme writes `.github/readme/hero.webp` and the light theme `.github/readme/hero-light.webp`; `README.md` picks one with `<picture>` and `prefers-color-scheme`.
- `--still` writes one still per theme with reduced motion on, instead of the loop.

## Consequences

- The README shows the same hero as the landing page, in the reader's theme, and moves the way it does.
- A change to the hero, the loupe or the demo renderer leaves the README behind until someone runs `generate:readme-hero`; nothing checks that the README hero is current.
- The generator needs `img2webp` and `cwebp` from libwebp on the PATH, and an Electron that can start an offscreen window.
- The README hero weighs about 5 MB per theme, where the old still weighed 110 KB.
- `apps/site/tests/readme-hero.test.ts` fails when `hold` lets a block shimmer or keeps a stale block past the settled quality.
  `closeLoop` stops the generator when more than 3% of the blocks differ where the loop wraps.
  `apps/site/tests/site.test.ts` still fails when the site uses a README image other than `hero.webp`.
