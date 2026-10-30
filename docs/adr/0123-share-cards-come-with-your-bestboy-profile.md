# 0123 - Share cards come with your Bestboy profile

Status: accepted

## Context

0121 let anyone copy share cards without an account, drawn with their GitHub login where a Bestboy handle goes and `bestboy.dev/malini` in the corner.
The user found it confusing: a card claimed `bestboy.dev/@login`, a profile that did not exist, and Malini showed no account at all, because signing in lived only inside **Publish my stats** and the only way to it was a switch in Settings, Profile.
The user's call: "it's a perfectly fair deal to have someone sign up for the sake of having access to the platform features like sharing your stats."
So share cards now belong to a published profile, the Stats panel nudges to publish, and Settings shows the Bestboy account whether or not you publish.
Everything else in 0121 still holds and is restated below.

0058 kept Malini to two outbound calls of its own, usage data to Logdash and update checks, and said a third one is a new decision.
The user wants a public profile at `bestboy.dev/@handle` that shows how advanced and intense an agent user someone is, and ranks them against community percentiles ("Standing"), with no person-to-person comparison.
Bestboy's platform already signs people in for Grip, so Malini becomes its second app instead of growing an account of its own.
The user's rules: publishing is opt-in and off by default, Malini uploads numbers only and the platform draws every card from them, nothing reveals when someone works, agent hours stay private because divided by agents at once they give the hours someone works a day, and no prompt, path, file name, code or repository name leaves the Mac except public repositories the person picks.
Skill and MCP server names are the interesting part of a profile, but a skill or server someone wrote can carry the name of a private project.
Everything else in 0058 still holds and is restated below.

## Decision

- Malini is an Electron app in `apps/malini`, built for macOS, and keeps all its state on the Mac, in SQLite (0004), clones and workstreams (0041).
  There is no Malini server, and Malini itself needs no account.
- GitHub is reached through the user's `gh` CLI.
- The app makes three outbound calls of its own:
  - Usage counts and error names to Logdash, from `src/lib/app/platform/usage-data.ts`, exactly as 0058 set them, and silent without `MAIN_VITE_LOGDASH_SITE` and `MAIN_VITE_LOGDASH_API_KEY`.
  - Update checks against GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml` (0008).
  - Your Bestboy profile at `https://bestboy.dev`, from `src/lib/stats/platform/`, only after you turn on **Publish my stats** in Settings, Profile.
    While it is on, Malini also downloads the public catalog `GET /api/catalog` from the same origin, without a token, gzip-compressed (about 0.9 MB), at most once a local day and right before an upload; privacy needs the whole list on the Mac, so matching never asks the platform about a name.
- **Account.** Settings, Profile always shows the Bestboy account: **Not signed in to Bestboy** with **Sign in**, or **Signed in to Bestboy as** your name with **Sign out**.
  Signing in there publishes nothing; the switch stays off until you turn it on, and turning it on while signed out signs you in first.
- **Sign-in.** Malini signs in the way Grip does, with `app=malini`: a PKCE sign-in in the default browser, the code back through `malini://auth`, then `POST /api/auth/token`.
  `bestboy.ts` is the client and `stats-profile.ts` holds the sign-in, which ignores a state it did not ask for and gives up after 10 minutes.
  The token stays encrypted with `safeStorage` in `bestboy-profile.json` in the app data folder, and never reaches the renderer.
  Packaged builds declare the `malini` scheme in `electron-builder.yml`, and `src/main/index.ts` routes `open-url` and second-instance URLs to the pending sign-in.
  `pnpm dogfood` is the user's daily Malini and runs `pnpm dev`, so it claims the scheme too: `scripts/dogfood.mjs` passes `MALINI_DOGFOOD=1`, `scripts/dev-bundle.mjs` then declares `malini` in its `Malini.app`, and `claimsUrlScheme` in `src/main/url-scheme.ts` calls `setAsDefaultProtocolClient` only for that run.
  A plain `pnpm dev`, the e2e harness, `test-malini-app` and every background launch (`MALINI_BACKGROUND_WINDOW=1`) never register it.
  A callback that still reaches another Malini, such as an agent's test instance, changes nothing there: it holds no pending sign-in, so the `state` check drops it.
  `MALINI_BESTBOY_ORIGIN` points an unpackaged build at a local platform.
- **What goes up.** `PUT /api/stats/malini` sends Stats v1, which `src/lib/stats/domain/published-stats.ts` computes from the local database.
  It counts complete local days only, through yesterday, leads with typical values and sends peaks beside them, and takes names only from closed lists: model families, languages, Claude Code's built-in tools, `Browser`, `MCP`, `malini` and `other`, plus the public repositories you picked while GitHub reports them public.
  It sends no agent hours, and every list holds at most 40 names, folding the rest into `other`.
  "How runs work" counts the runs that used Malini's browser, a sub-agent (`Agent`, `Task`), a skill, an MCP server other than Malini's own, and the web (`WebSearch`, `WebFetch`).
  A trigger on `agent_events` keeps tool calls per run, and each `Skill` call's skill, in `agent_run_tool_calls` (migration 81), so a snapshot never scans every event.
  Migration 81 flags every chat packed before it, and the packing pass in `event-packs.service.ts` counts those packs once, so archived chats count too; `listFinishedRunToolCalls` counts any pack still left before it answers, so the first card or upload after the update is already complete.
- **Catalog names.** A skill or MCP server is named only when the catalog lists it from the source it came from on this Mac, matched in `src/lib/stats/domain/catalog-names.ts` from what `agent-setup.ts` reads.
  A built-in skill counts by name only when no personal or repository skill shares it.
  A plugin counts only when `known_marketplaces.json` records `claude-plugins-official` from GitHub `anthropics/claude-plugins-official` and `installed_plugins.json` lists the plugin from it; the catalog carries no other marketplace, since Claude Code reserves only the official names and a community plugin's name can be personal.
  Each MCP server gets one name, first match wins: `malini` for Malini's own; the registry name when its configuration runs one of an entry's `packages` or points at one of its `remotes`, a plugin's server included (read from the `.mcp.json` and `plugin.json` at its install path); `plugin:server` for an official plugin's server the catalog lists for it; else `other`.
  So a server counts once however it was installed.
  A server's configuration stays in memory only, to derive its package or remote; its `env`, `headers` and the rest are never stored, logged or sent.
  Everything else is summed into `other`; without a catalog, every skill and server but `malini` is `other`, and the upload still goes.
  The last catalog stays in `bestboy-catalog.json`.
- **Parts.** Six parts have their own switch under **What your profile shows**, all on by default: `techniques`, `tools`, `models`, `languages`, `mcpServers` and `skills`.
  `sharedStats` leaves a part that is off out of the payload; `version`, `through`, `since`, `totals`, `days` and `intensity` always go.
- **When.** Malini uploads when the switch turns on, at most once per local day while it stays on, and three seconds after you change your picks or a part, backing off from a minute to an hour on transient errors.
- **Off.** Turning the switch off sends `DELETE /api/stats/malini`, then `PUT /api/profile { public: false }`, and retries until both succeed.
  Signing out does the same first and then revokes the token, and any 401 drops the token and asks you to sign in again.
- **Share cards.** Share cards come with a published profile: while **Publish my stats** is on and the profile has an address, the Stats panel draws the heatmap and readout cards from the same snapshot on a canvas and copies them as PNGs.
  A card names you by your GitHub name and picture and by your Bestboy `@handle`, never by your GitHub login, so every card points at a profile that exists.
  Before that, the panel's **Share card** section says what publishing gets you and offers **Publish my stats**, which closes the panel, opens Settings, Profile and starts the same sign-in and handle steps as the switch.
  `stats.share-card` in `src/lib/stats/platform/register.ts` sends no handle unless the profile is published, and `StatsPanel.svelte` shows `ShareCards` or `PublishNudge` from the profile state.
  Both cards are flat, with no glow, grain or grid, to match the platform's own cards, and neither shows agent hours.
- No call carries an error message, a stack, a prompt, a path, a file name, code, an email, a time of day, or a repository name you did not pick.

## Consequences

- The Bestboy account stays optional: everything but your profile and its share cards works without it.
- Someone who wants a card without a public profile cannot get one; that is the trade the user chose for one model, account, then profile, then cards.
- The platform validates every field of an upload and stores only what it rebuilt from them; Malini computes valid numbers by construction and caps a run's length at 30 days.
- A profile changes once a day at 03:00 UTC, so when an upload arrives never shows when someone works.
- Only the packaged app and `pnpm dogfood` receive `malini://auth`; signing in from any other dev build needs the callback handed to the app.
- A new field in Stats v1, or a new name in its closed lists, changes the contract on both sides and the docs page `apps/site/content/profile.md`.
- Matching uses what is installed when Malini uploads, so a plugin you uninstalled turns its past uses into `other`.
- Another marketplace later needs the catalog to carry its GitHub repository, so Malini can check where a plugin came from.
- Enforced by `src/lib/stats/platform/published-stats.test.ts` (the through-yesterday cutoff, a run across midnight, agents at once weighted by time, an orphaned run, the name filters, How runs work), `src/lib/stats/platform/stats-profile.test.ts` (a retry, the removal before sign-out, a 401, each of the six parts, one catalog download a day, an upload without a catalog), `src/lib/stats/domain/catalog-names.test.ts` (names by source, the server order), `src/lib/stats/platform/agent-setup.test.ts` (the official marketplace check, plugin servers read from their install), `src/main/db/migrations.test.ts` (tool and skill counts from old and new events), `src/lib/chat/platform/event-packs.test.ts` (chats packed before migration 81 counted once), `src/main/url-scheme.test.ts` and `scripts/dev-bundle.test.mjs` (only dogfood claims the scheme), and `tests/e2e/profile.spec.ts` (a callback nobody asked for is dropped, the signed-out account row, sign-in, numbers only, the compressed catalog download, a part switched off, a 401, the order of a switch-off, sign-out, the Stats panel nudge instead of cards, signing in without publishing, copying both cards once the profile is public).
