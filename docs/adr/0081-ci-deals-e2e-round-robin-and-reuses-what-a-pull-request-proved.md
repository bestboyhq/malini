# 0081 - CI deals e2e tests round robin and reuses what a pull request proved

Status: accepted

## Context

0046 ran the e2e suite as three `--shard` slices, and pull request runs took 12 to 20 minutes, a push to `main` 25.
Playwright cuts a shard as a contiguous run of tests in file order, so the slow `transcript-*` specs all landed in the last slice: in run 40203226328 shard 3 took 11.5 minutes and shard 2 took 6.9.
That run's 279 tests add up to about 2,970 seconds, and a shard with two workers takes about half of its own share.
GitHub Free runs at most five macOS jobs at once (0036), and the push to `main` held the `release` (5.5 minutes) and `update` (9.5 minutes) jobs until every test passed.
Every job also built the site and the app where it ran neither.
A push to `main` re-ran the e2e suite a pull request had already passed on the same code, and ran the signed-update test on every release, about 42 macOS minutes per merge at about 12 merges a day.
The e2e suite runs the unpackaged build, so the update test was also the only check that a signed build boots.
The user asked for CI to be heavily optimized and is sensitive to both cost and time, so the organization stays on GitHub Free.

## Decision

- The `app` job in `.github/workflows/ci.yml` lists the suite with `playwright test --list`, keeps every n-th test from its own number with `awk 'NR % n == i % n'`, and runs them with `playwright test --test-list`.
- The step fails when its list is empty, since Playwright passes an empty `--test-list`, and when Playwright finds fewer tests in it than were dealt, since a title holding `›` splits there.
- A pull request runs five shards and a push to `main` three, through `fromJSON` on `github.event_name`; each shard reads its count from `strategy.job-total`.
- On a push, `version`, `reuse` and `release` start without waiting for the tests, and `update` starts once `reuse` has decided; `publish` needs `checks`, `unit`, `app`, `release` and `update`.
- The `app` job builds `malini...` and the `unit` job `malini^...`; `checks` still builds every package.
- On a pull request, once every e2e shard passed, the `proof` job uploads an artifact named `e2e-passed-<tree>`, the hash of the tree the shards tested, kept 14 days.
- On a push, the `reuse` job looks that artifact up for the pushed commit's tree, from a run on a branch of this repository, never a fork, and skips the `app` job when it finds one.
- The `reuse` job runs the `update` job only when a file it covers changed since the last `v*` tag: the updater and its menu and button, boot, the window and the storage name in `src/main`, the preload, `electron-builder.yml`, `build/`, `package.json`, the lockfile and workspace, `scripts/update-e2e.mjs` and CI.
- The `release` job opens the signed build with `scripts/packaged-smoke.mjs` in background mode, finishes onboarding through IPC and waits for `Malini · Repositories`.
- `publish` runs once `release` passed and no job it needs failed or was cancelled, so a skipped `app` or `update` does not hold it; a failed `reuse` runs both jobs it gates.
- This reverses the clause of 0046 that ran three `--shard` slices; the rest of 0046 stands.

## Consequences

- Every shard gets about the same share of slow specs: five shards on a pull request take about 600 seconds of tests each, half that with two workers.
- A pull request holds all five macOS runners for a few minutes, so a second run waits for it instead of sharing; the total runner time barely changes.
- On `main` the three shards, `release` and `update` fill the five runners at once, so a release publishes about 15 minutes sooner.
- A pull request merged while `main` stood still skips e2e on its push, since its squash commit has the tree its merge ref had; one merged after `main` moved runs e2e again.
- The update test would have run for 2 of the 12 releases before v0.58.0; every release still boots its signed build once.
- An updater change in a file the list misses ships without the update test, so new updater files carry `update` in their name or join the list.
- Rotating the Developer ID certificate changes no file, so run `pnpm --filter malini test:update` by hand after one.
- `.github/actions/setup` keeps `check-latest`, though it downloads Node in every job: the runner's Node 24.21.0 predates the rewrite of recursive `fs.watch` on Linux in 24.22, and `watcher.test.ts` lost an oversized burst in 26 of 40 runs on it, against none on 24.22.1.
- A commit whose tests then fail can still be built, signed and notarized; `publish` never ships it, and the macOS minutes are lost.
- Enforced by `.github/workflows/ci.yml`; nothing checks the shard counts against the five-runner cap.
