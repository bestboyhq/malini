# 0119 - Malini publishes your stats to bestboy.dev when you ask

Status: accepted

## Context

0058 kept Malini to two outbound calls of its own, usage data to Logdash and update checks, and said a third one is a new decision.
The user wants a public profile at `bestboy.dev/@handle` that shows how advanced and intense an agent user someone is, and lets people compare how they work with agents, the tools their agents reach for first; that comparison is the long game.
Bestboy's platform already signs people in for Grip, so Malini becomes its second app instead of growing an account of its own.
The user's rules: publishing is opt-in and off by default, Malini uploads numbers only and the platform draws every card from them, nothing reveals when someone works, and no prompt, path, file name, code or repository name leaves the Mac except public repositories the person picks.
Everything else in 0058 still holds and is restated below.

## Decision

- Malini is an Electron app in `apps/malini`, built for macOS, and keeps all its state on the Mac, in SQLite (0004), clones and workstreams (0041).
  There is no Malini server, and Malini needs no account.
- GitHub is reached through the user's `gh` CLI.
- The app makes three outbound calls of its own:
  - Usage counts and error names to Logdash, from `src/lib/app/platform/usage-data.ts`, exactly as 0058 set them, and silent without `MAIN_VITE_LOGDASH_SITE` and `MAIN_VITE_LOGDASH_API_KEY`.
  - Update checks against GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml` (0008).
  - Your Bestboy profile at `https://bestboy.dev`, from `src/lib/stats/platform/`, only after you turn on **Publish my stats** in Settings, Profile.
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
  A trigger on `agent_events` keeps tool calls per run in `agent_run_tool_calls` (migration 81), so a snapshot never scans every event.
- **When.** Malini uploads when the switch turns on, at most once per local day while it stays on, and three seconds after you change your picks, backing off from a minute to an hour on transient errors.
- **Off.** Turning the switch off sends `DELETE /api/stats/malini`, then `PUT /api/profile { public: false }`, and retries until both succeed.
  Signing out does the same first and then revokes the token, and any 401 drops the token and asks you to sign in again.
- **Share cards.** The Stats panel draws the heatmap and readout cards from the same snapshot on a canvas and copies them as PNGs, without an account.
- No call carries an error message, a stack, a prompt, a path, a file name, code, an email, a time of day, or a repository name you did not pick.

## Consequences

- Malini has an optional account for the first time; everything works without it, Copy card included.
- The platform validates every field of an upload and stores only what it rebuilt from them; Malini computes valid numbers by construction and caps a run's length at 30 days.
- A profile changes once a day at 03:00 UTC, so when an upload arrives never shows when someone works.
- Only the packaged app and `pnpm dogfood` receive `malini://auth`; signing in from any other dev build needs the callback handed to the app.
- A new field in Stats v1, or a new name in its closed lists, changes the contract on both sides and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/platform/published-stats.test.ts` (the through-yesterday cutoff, a run across midnight, agents at once weighted by time, an orphaned run, the name filters), `src/lib/stats/platform/stats-profile.test.ts` (a retry, the removal before sign-out, a 401), `src/main/db/migrations.test.ts` (tool counts from old and new events) `src/main/url-scheme.test.ts` and `scripts/dev-bundle.test.mjs` (only dogfood claims the scheme), and `tests/e2e/profile.spec.ts` (a callback nobody asked for is dropped, sign-in, numbers only, a 401, the order of a switch-off, sign-out, copying both cards).
