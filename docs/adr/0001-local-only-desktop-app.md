# 0001 - A local-only desktop app

Status: superseded by 0050

## Context

Malini runs coding agents against the user's repositories with the user's own Claude login and GitHub credentials.
Everything it drives already lives on the user's machine: `git`, `gh`, `claude`, Docker and the file system.
A hosted service would hold their code, prompts and tokens, and would need accounts, servers and an uptime promise.

## Decision

- Malini is an Electron app in `apps/malini`, built for macOS.
- There is no backend and no cloud: all state lives in the app data folder, in SQLite (ADR 0004), clones and workstreams (ADR 0006).
- GitHub is reached only through the user's `gh` CLI.
- The app makes two outbound calls of its own:
  - Anonymous usage data to PostHog, from `src/lib/app/platform/usage-data.ts`.
    It is silent without `MAIN_VITE_POSTHOG_KEY`, and off with `MALINI_USAGE_DATA=off`, `DO_NOT_TRACK=1` or the Share usage data setting.
  - Update checks against GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml` (ADR 0008).

## Consequences

- No sign-in and nothing to host; the user's code and prompts stay on their machine.
- Every capability depends on a tool the user installed, so Malini has to detect a missing or broken `git`, `gh`, `claude` or Docker and explain it in plain words.
- Usage data never carries code, prompts, paths or keys.
  `COMMAND_USAGE` in `src/lib/app/platform/usage-events.ts` is typed as a record over every command name, so `pnpm check` fails until a new command declares what it reports: `false`, or an explicit property picker.
- A third outbound call is a new decision: it needs its own ADR and an update to `AGENTS.md`.
