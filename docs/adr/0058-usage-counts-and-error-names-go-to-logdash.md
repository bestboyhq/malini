# 0058 - Usage counts and error names go to Logdash

Status: superseded by 0119

## Context

0001 kept Malini local-only and sent anonymous usage data to PostHog: an event per command, every screen, run summaries with tokens and cost, GeoIP, all under a stable install id.
The release job never passed `MAIN_VITE_POSTHOG_KEY`, so no shipped build reported anything.
The user wants to know only whether people use Malini, as active installs and runs per day, and which errors they hit, so those who share them get help first.
PostHog is not privacy first, and the site already counts visits and downloads with Logdash (0043).
Everything else in 0001 still holds and is restated below.

## Decision

- Malini is an Electron app in `apps/malini`, built for macOS.
- There is no backend and no cloud: all state lives in the app data folder, in SQLite (0004), clones and workstreams (0041).
- GitHub is reached only through the user's `gh` CLI.
- The app makes two outbound calls of its own:
  - Usage counts and error names to Logdash, from `src/lib/app/platform/usage-data.ts`.
  - Update checks against GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml` (0008).
- Usage counts are Logdash web analytics events, `POST https://api.logdash.io/web_events` with `Origin: https://app.malini` for the site in `MAIN_VITE_LOGDASH_SITE`:
  - `app_active` once per launch, and `run_finished` for every agent run that completes or fails.
  - No properties and no user id: Logdash counts a visitor per day from a daily salt, the IP and the user agent, and stores no IP.
- Error names are Logdash logs, `POST https://api.logdash.io/logs` with the write-only project key in `MAIN_VITE_LOGDASH_API_KEY`, at level `error` in namespace `malini@<version>`:
  - A command failure at level `error` by `commandFailureLevel`, an uncaught exception, an unhandled rejection, and a renderer or child process that is gone without a clean exit.
  - Each line reads `<what> failed: <name> <code> (<kind>) · malini <version> · macOS <version> <arch>`, and each distinct line is sent once per launch.
- Neither call carries an error message, a stack, a path, a prompt or code.
- Each call is silent without its variable, and both stop with `MALINI_USAGE_DATA=off`, `DO_NOT_TRACK=1` or the Share usage data setting, which is on until the user turns it off.
- The release job in `.github/workflows/ci.yml` passes `secrets.MALINI_LOGDASH_SITE` and `secrets.MALINI_LOGDASH_API_KEY` into the build.

## Consequences

- Logdash shows active installs and runs per day, and which command broke on which version and macOS.
- There is no per-feature usage, screen funnel or per-install retention any more; `posthog-node`, `COMMAND_USAGE` and the install id are gone.
- Two installs behind one IP with the same Malini and macOS versions count as one visitor that day.
- The project key ships inside the app; it can only write logs and metrics, so the worst abuse is noise in the Malini project.
- A plain `Error` logs only its name, so finding its cause still needs the user's local diagnostics.
- `src/lib/app/platform/usage-data.test.ts` fails when a log line carries an error message, when an expected failure is logged, or when anything is sent once the setting is off.
- A third outbound call is a new decision: it needs its own ADR and an update to `AGENTS.md`.
