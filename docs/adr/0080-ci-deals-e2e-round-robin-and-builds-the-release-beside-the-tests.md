# 0080 - CI deals e2e tests round robin and builds the release beside the tests

Status: accepted

## Context

0046 ran the e2e suite as three `--shard` slices, and pull request runs took 12 to 20 minutes, a push to `main` 25.
Playwright cuts a shard as a contiguous run of tests in file order, so the slow `transcript-*` specs all landed in the last slice: in run 40203226328 shard 3 took 11.5 minutes and shard 2 took 6.9.
That run's 279 tests add up to about 2,970 seconds, and a shard with two workers takes about half of its own share.
GitHub Free runs at most five macOS jobs at once (0036), and the push to `main` held the `release` (5.5 minutes) and `update` (9.5 minutes) jobs until every test passed.
Every job also downloaded a newer Node through `check-latest`, and built the site and the app where it ran neither.
The user asked for CI to be heavily optimized.

## Decision

- The `app` job in `.github/workflows/ci.yml` lists the suite with `playwright test --list`, keeps every n-th test from its own number with `awk 'NR % n == i % n'`, and runs them with `playwright test --test-list`.
- The step fails when its list is empty, since Playwright passes an empty `--test-list`, and when Playwright finds fewer tests in it than were dealt, since a title holding `›` splits there.
- A pull request runs five shards and a push to `main` three, through `fromJSON` on `github.event_name`; each shard reads its count from `strategy.job-total`.
- On a push, `version`, `release` and `update` start at once; `publish` needs `checks`, `unit`, `app`, `release` and `update`.
- The `app` job builds `malini...` and the `unit` job `malini^...`; `checks` still builds every package.
- `.github/actions/setup` takes the runner's Node 24 and no longer sets `check-latest`.
- This reverses the clause of 0046 that ran three `--shard` slices; the rest of 0046 stands.

## Consequences

- Every shard gets about the same share of slow specs: five shards on a pull request take about 600 seconds of tests each, half that with two workers.
- A pull request holds all five macOS runners for a few minutes, so a second run waits for it instead of sharing; the total runner time barely changes.
- On `main` the three shards, `release` and `update` fill the five runners at once, so a release publishes about 15 minutes sooner.
- A commit whose tests then fail can still be built, signed and notarized; `publish` never ships it, and the macOS minutes are lost.
- Enforced by `.github/workflows/ci.yml`; nothing checks the shard counts against the five-runner cap.
