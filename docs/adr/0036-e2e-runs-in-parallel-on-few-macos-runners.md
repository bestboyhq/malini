# 0036 - E2E runs in parallel on few macOS runners

Status: accepted

## Context

0027 made the e2e suite the tier that guards behavior, and it ran one Electron app at a time on three `macos-latest` shards, about nine minutes each.
The repository's organization is on GitHub Free, which runs at most five macOS jobs at once across every pull request and `main`, so more shards wait in the queue instead of running: a shard on `main` has waited six and a half minutes for a runner.
A few tests spent most of their time waiting on the merge queue's real timers (45 seconds for checks, 30 for a push retry).
Running apps side by side surfaced a race: the merge queue read a pull request as open, then saw `main` move with that pull request's own merge, and updated the merged branch from main, which lost the merge.
`changed-files-performance.spec.ts` holds a two-second budget, so it cannot share a runner with other apps.
A CI runner is three M1 vCPUs and runs a test about twice as slowly as a developer Mac, where one app keeps about one core busy.

## Decision

- `apps/malini/playwright.config.ts` runs two workers on CI and a third of the cores locally.
- Specs named `*-performance.spec.ts` form the `performance` project, one at a time; every other spec is the `app` project.
- `.github/workflows/ci.yml` runs `--project=app` as three shards and `--project=performance` as a fourth job, alone on its runner.
- The e2e harness sets `MALINI_SHIP_DELAY_SCALE=0.1`; an unpackaged build multiplies every merge queue delay (`DEFAULT_SHIP_DELAYS` in `src/lib/pull-requests/domain/merge-queue.ts`) by it, and a packaged build ignores it.

## Consequences

- A run takes four macOS jobs of a few minutes each instead of three of about nine, so the five-job cap frees runners sooner.
- Specs run beside other apps, so a timeout must cover the product's slowest refresh under load, not the typical case.
- A spec that measures timing is named `*-performance.spec.ts` so it runs alone.
- Merge queue timing reaches e2e ten times faster; a spec that needs the real delays passes its own `MALINI_SHIP_DELAY_SCALE` through `launchMalini({ env })`.
- Enforced by the CI workflow and the Playwright config; nothing checks that a timing spec carries the `-performance` name.
