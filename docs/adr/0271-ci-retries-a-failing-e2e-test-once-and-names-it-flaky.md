# 0271 - CI retries a failing e2e test once and names it flaky

Status: accepted

## Context

`playwright.config.ts` ran with no retries since the first commit, so one flaky test failed its whole shard.
On `main` a failed shard stops the release, since the publish job refuses to publish while any job did not succeed.
After #216, `first-run.spec.ts:186` failed in 3 of 4 macOS runs on CI and in none of about 150 local runs, so a race that only a slow CI runner meets blocked every merge.
The merge queue re-runs failed jobs once (0126), but that re-runs a whole shard, costs a full CI run, and does not happen on `main` at all.
A flake is still a bug, often a race in the product, so a retry must not hide it.

## Decision

`apps/malini/playwright.config.ts` sets `retries: process.env['CI'] ? 1 : 0`.
A local run never retries, so a flake fails where an agent can see it at once.
On CI the `github` reporter runs beside `list`: a test that passes on its retry is `flaky`, the job stays green, and the run shows it as an error annotation and in the `Playwright Run Summary` notice.
`trace: 'retain-on-failure'` keeps the trace of the failed attempt, and `.github/workflows/ci.yml` uploads `apps/malini/test-results` as `playwright-report-<shard>` after every run that was not cancelled, so a green job keeps the evidence of its flakes.
The **Fix the worst flaky test** automation runs every day: it reads the flaky and failed e2e tests of recent CI runs, picks the one that flakes most often, reproduces it and fixes its root cause.

## Consequences

One flake no longer fails a shard, a pull request or the release on `main`.
A test that fails twice in a row still fails its job, and the merge queue re-run (0126) still applies to it.
A flake no longer stops anyone, so it can pile up; the annotations, the uploaded traces and the daily automation keep it visible and fixed one at a time.
Each flaky test costs one more run of that test on CI, not of its shard.
Only `playwright.config.ts` holds this decision; no test fails when it changes.
