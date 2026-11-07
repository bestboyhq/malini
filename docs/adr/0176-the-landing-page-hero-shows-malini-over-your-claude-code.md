# 0176 - The landing page hero shows Malini over your Claude Code

Status: accepted

## Context

0161's hero played Tony's workstream from prompt to merged pull request with a scripted cursor.
A section drafted after Harness showed a Malini window over the user's own Claude Code setup, with a glass loupe magnifying the line of CLAUDE.md, settings.json or the skills folder each step came from.
Of three looks, the user picked the one where Malini stays solid and only the loupe shows what is underneath: "this best, but loupe movements are a bit too feral, and make the loupe radius bigger", and "this mockup still doesn't look exactly like malini".
Then: "that loupe with interface should be in our hero section, and our hero pitch should be "Missing abstraction layer for building with agents"".
This replaces 0161's hero script; 0119's demo bridge, report cards, build and Open Graph view stay in force.

## Decision

- `apps/site/src/lib/Hero.svelte` reads "Missing abstraction layer" with the quiet line "for building with agents", and its plate renders `SetupLoupe.svelte`; the Open Graph view keeps `hero.webp` (0087).
- `SetupLoupe.svelte` stacks three layers.
  At the bottom, text feeds of a made-up `~/.claude`: CLAUDE.md, the skills folder, the `~/.claude` tree and settings.json.
  Above them, an inert iframe of `app` on `/workstreams/ws-malini-duplicate` with `?play=setup`.
  On top, the WebGL2 loupe in `apps/site/src/lib/loupe.ts` cuts a hole in the app and magnifies the feed under it; without WebGL2 the hole shows the feed through a CSS lens ring.
- `?play=setup` lists `SETUP_WORKSTREAM` from `demo-data.ts`, whose agent says a line before each of `Skill draw-icon`, the Svelte plugin's autofixer, `pnpm check` and `Skill test-malini-app`, so each call gets its own row.
  `demo-setup.ts` posts the box of every `assistant`, `tool` and `bash` row to the site as `malini-demo:rows`, polled every 300 ms and sent only on change, so the site centers a narrow stage on the chat column.
- Six steps, one every 4.8 s, each feed that step's lines into its column; the chat rows stay as the app draws them, with no highlight or tag of the site's.
  The loupe glides to them on a critically damped spring of stiffness 40 and parks over the sidebar or the inspector, never the chat.
- The loupe's radius is 14% of the stage width, held between 128 and 160 px, and magnifies 1.4x at 128 px up to 1.6x at 160 px.
- A stage narrower than 860 px merges the feeds into one column and parks the loupe low, under the transcript; the app keeps a width of 1200 px at 0.6 scale, cropped around its chat column.
  At 639 px and below the stage is 9:16.
- Under reduced motion the hero is one still frame on the CLAUDE.md step, and the loupe follows the pointer.
- `?play=hero`, `demo-script.ts`, `heroSteps`, `HERO_ID` and `HERO_THOUGHT` are deleted; Tony's workstream stays for its report card.
- Tool rows drop a plugin's `plugin_<name>_` or `plugin:<name>:` prefix from an MCP server's name, through `withoutPluginPrefix` in `$lib/chat/domain/mcp-server.ts`, so the window reads "Svelte · Autofixer", and a Skill call reads "Skill · draw-icon".

## Consequences

- A visitor first sees Malini as a layer over the Claude Code they already have, the claim of the headline.
  The hero no longer carries a task to a merged pull request; How it works and the report cards still tell that loop.
- The hero app is inert, so a visitor can no longer click around in it as 0161's could.
- The site finds rows by `data-message-kind` `assistant`, `tool` and `bash`, and fades the app in only once rows arrive; renaming those kinds leaves the hero empty.
- A lit line must stay within 23 characters to fit the loupe's flat center at 128 px; nothing checks it.
- Nothing tests the loupe; `apps/site/tests/site.test.ts` fails only when the landing page stops embedding `app`, and fails when the headline changes until `pnpm --filter @malini/site generate:og-image` re-renders the Open Graph image.
