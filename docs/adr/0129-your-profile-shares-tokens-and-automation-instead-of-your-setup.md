# 0129 - Your profile shares tokens and automation instead of your setup

Status: accepted

## Context

0123 had Malini upload six named parts to your Bestboy profile, each with its own switch: how runs work, tools, models, languages, MCP servers and skills, the last two named only from a public catalog Malini downloaded daily.
On their own profile, the user said: "instead of all this stats, id rather share: 1. total token consumption 2. automation score - how much of my work is automated vs manual".
The six parts and the catalog that named skills and servers were the most code and the most privacy care in the upload, and the profile no longer shows any of them, so Malini stops computing and sending them.
The bridge already reports each run's final usage, and `agent_runs.automated`, the session's `origin` and a prompt's `from` already tell which runs you did not prompt.
Everything else in 0123 still holds and is restated below.

## Decision

- Malini is an Electron app in `apps/malini`, built for macOS, and keeps all its state on the Mac, in SQLite (0004), clones and workstreams (0041).
  There is no Malini server, and Malini itself needs no account.
- GitHub is reached through the user's `gh` CLI.
- The app makes three outbound calls of its own:
  - Usage counts and error names to Logdash, from `src/lib/app/platform/usage-data.ts`, exactly as 0058 set them, and silent without `MAIN_VITE_LOGDASH_SITE` and `MAIN_VITE_LOGDASH_API_KEY`.
  - Update checks against GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml` (0008).
  - Your Bestboy profile at `https://bestboy.dev`, from `src/lib/stats/platform/`, only after you turn on **Publish my stats** in Settings, Profile.
    It no longer downloads `GET /api/catalog`.
- **Account.** Settings, Profile always shows the Bestboy account: **Not signed in to Bestboy** with **Sign in**, or **Signed in to Bestboy as** your name with **Sign out**.
  Signing in there publishes nothing; the switch stays off until you turn it on, and turning it on while signed out signs you in first.
- **Sign-in.** Malini signs in the way Grip does, with `app=malini`: a PKCE sign-in in the default browser, the code back through `malini://auth`, then `POST /api/auth/token`.
  `bestboy.ts` is the client and `stats-profile.ts` holds the sign-in, which ignores a state it did not ask for and gives up after 10 minutes.
  The token stays encrypted with `safeStorage` in `bestboy-profile.json` in the app data folder, and never reaches the renderer.
  Packaged builds declare the `malini` scheme in `electron-builder.yml`, and `src/main/index.ts` routes `open-url` and second-instance URLs to the pending sign-in.
  `pnpm dogfood` claims the scheme too, through `MALINI_DOGFOOD=1`, `scripts/dev-bundle.mjs` and `claimsUrlScheme` in `src/main/url-scheme.ts`; a plain `pnpm dev`, the e2e harness, `test-malini-app` and every background launch never register it.
  `MALINI_BESTBOY_ORIGIN` points an unpackaged build at a local platform.
- **What goes up.** `PUT /api/stats/malini` sends Stats v1, which `src/lib/stats/domain/published-stats.ts` computes from the local database: `version`, `through`, `since`, `totals`, `days`, `intensity`, `repositories` and `otherRepositories`, all of it every time.
  It counts complete local days only, through yesterday, leads with typical values and sends peaks beside them, and names only the public repositories you picked while GitHub reports them public.
  It sends no agent hours.
- **Tokens.** `totals.inputTokens` and `totals.outputTokens` sum the runs finished through yesterday.
  Input counts what the model read, prompt-cache reads and writes included, as the bridge reports it in each run's final `usage.updated`.
  Migration 83 keeps each run's last final usage in `agent_runs.input_tokens` and `output_tokens`, from the events before it and through the `agent_events_count_tokens` trigger after, so a snapshot never scans every event.
- **Automation.** `totals.automatedRuns` counts the runs you did not prompt: a job's, a run Malini started itself (`agent_runs.automated`: a workstream's report, a resume after a limit, Implement on a plan), and a run whose first prompt another chat sent (`from` on its `user.message`).
  `listRunFacts` in `runs.repository.ts` decides it per run; the platform shows `automatedRuns / runs` as the automation score.
- **When.** Malini uploads when the switch turns on, at most once per local day while it stays on, and three seconds after you change your picks, backing off from a minute to an hour on transient errors.
- **Off.** Turning the switch off sends `DELETE /api/stats/malini`, then `PUT /api/profile { public: false }`, and retries until both succeed.
  Signing out does the same first and then revokes the token, and any 401 drops the token and asks you to sign in again.
- **Share cards.** Share cards come with a published profile: while **Publish my stats** is on and the profile has an address, the Stats panel draws the heatmap and readout cards from the same snapshot on a canvas and copies them as PNGs.
  A card names you by your GitHub name and picture and by your Bestboy `@handle`, never by your GitHub login.
  Before that, the panel's **Share card** section offers **Publish my stats**.
  Both cards are flat, with no glow, grain or grid, and neither shows agent hours.
- No call carries an error message, a stack, a prompt, a path, a file name, code, an email, a time of day, a tool, skill, server, model or language name, or a repository name you did not pick.

## Consequences

- An upload holds numbers and picked repository names only, so nothing in it needs a catalog, a closed list of names or a switch per part.
- Older Malini builds still send the six parts and fetch the catalog; the platform drops what it no longer shows, and an older build that cannot fetch the catalog uploads anyway.
- The total token count includes cache reads, so it runs far above what a bill counts as fresh input; the docs page says what it counts.
- A run from before Malini recorded `from` or `automated` counts as yours.
- `bestboy-catalog.json` stays in the app data folder of anyone who published before this change, unused.
- A new field in Stats v1 changes the contract on both sides and the docs page `apps/site/content/profile.md`.
- Enforced by `src/lib/stats/platform/published-stats.test.ts` (the through-yesterday cutoff, a run across midnight, agents at once weighted by time, an orphaned run, tokens of finished runs only, the runs you did not prompt), `src/lib/stats/platform/stats-profile.test.ts` (a retry, numbers only, the removal before sign-out, a 401), `src/main/db/migrations.test.ts` (tokens from old and new events, interim usage skipped), `src/main/url-scheme.test.ts` and `scripts/dev-bundle.test.mjs` (only dogfood claims the scheme), and `tests/e2e/profile.spec.ts` (sign-in, numbers only with tokens and automated runs, no catalog download, a 401, the order of a switch-off, sign-out, copying both cards once the profile is public).
