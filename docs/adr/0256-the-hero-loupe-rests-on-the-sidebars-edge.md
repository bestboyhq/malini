# 0256 - The hero loupe rests on the sidebar's edge

Status: accepted

## Context

0176 parked the hero loupe over the sidebar or the inspector, never the chat, and 0188 rested its CLAUDE.md step at the top of the sidebar.
On the widest stage, 1120 px, the loupe is 314 px across and the app's sidebar 299 px, so each sidebar stop hid the whole sidebar: the filter, the repositories and their workstreams.
The user: "our loupe sits directly on the sidebar, but sidebar is one of the most interesting surfaces in our app. Can we move it slightly to the right or some other position?"
Three directions were drawn on the built site: every stop in the empty inspector, the sidebar stops under the repository rows, and the sidebar stops on the sidebar's right edge, half over the chat.
The user picked the last.
The settings.json stops at 34% of the stage height also covered the inspector's Changes and Browser rows.

## Decision

- This amends 0176's "never the chat" and 0188's step heights and resting spot; the rest of both holds.
- `apps/site/src/lib/SetupLoupe.svelte` makes the sidebar feed twice as wide as the app's sidebar, `SIDEBAR_WIDTH` 320 px of `APP_WIDTH` 1200 px, so its center, where the loupe parks, is the sidebar's right edge.
  The stage is at most 1120 px wide, so the app always draws at 1200 px scaled to the stage, and that edge stays at 26.7% of it.
- The sidebar feed's lines start at 18% of the stage, where the loupe on that edge starts to magnify.
  The `~/.claude` tree feed, now between 53% and 72%, loses its left rule, since no pane edge is there.
- The settings.json feed is 28% wide, so its stops rest against the stage's right edge, clear of the composer's send button and the changed-files bar.
- The six steps sit at 30, 40, 78, 40, 20 and 66% of the stage height, so the settings.json stops clear Changes and Browser, and two steps in a row in one column still sit at least a third of the stage apart.
- A narrow stage keeps one feed with a 24 px indent.
- `og.png` and `og-source.sha256` are re-rendered, and `og:image:alt` in `Head.svelte` puts the loupe on the sidebar's edge.

## Consequences

- At every step, the resting one and the Open Graph card included, the left half of the sidebar stays readable: the filter, the repository names and the start of each workstream.
  Changes and Browser stay readable too.
- On the sidebar's edge the loupe covers the chat's tab title, the prompt and the start of the first replies; the chat rows still get no highlight or tag of the site's (0176).
- With the pointer on the left fifth of the sidebar, the loupe magnifies empty ground, because the sidebar feed starts at 18%.
- The demo app draws its sidebar at `SIDEBAR_DEFAULT_WIDTH` from `apps/malini/src/lib/app/domain/sidebar-width.ts`; a new default moves the edge, and nothing checks that `SIDEBAR_WIDTH` follows it.
- Nothing tests where the loupe parks.
  `apps/site/tests/site.test.ts` fails on any change here until `pnpm --filter @malini/site generate:og-image` re-renders the card.
