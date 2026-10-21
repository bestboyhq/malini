# 0046 - E2E holds no time budget

Status: accepted

## Context

0035 deleted the transcript's frame budgets because CI runners never met them, but kept the two-second budget in `changed-files-performance.spec.ts` because CI met it.
0036 then gave that one spec a Playwright project and a fourth macOS job of its own, so it never shared a runner.
The user wants no end-to-end test held to a time at all: the machines that run the suite have no consistent resources, so a budget measures the machine, not the app.
The motion specs had the same flaw in another form: they slept a fixed 400 to 1,500 ms for the transcript to settle before sampling and to end a sampling window.
On a loaded machine that wall time holds fewer frames, so a spec could start sampling mid-glide or see too few frames, and fail with nothing wrong in the app.

## Decision

- `tests/e2e/changed-files-performance.spec.ts` is `tests/e2e/changed-files-scale.spec.ts`: it still opens a chat with 20,000 changed files, shows the list and scrolls to its last row, with no time budget.
- No e2e spec asserts on elapsed time; a timeout only bounds how long a spec waits.
- `apps/malini/playwright.config.ts` has one project, with two workers on CI and a third of the cores locally, as 0036 set them.
- `.github/workflows/ci.yml` runs the suite as three shards, `--shard=1/3` to `3/3`, and no job of its own for timing.
- A spec that waits for the transcript to settle calls `untilStill(page)` from `tests/e2e/harness.ts`.
  It returns after 24 frames in a row with the chat scroller's `scrollTop` and height unchanged, no row glide in view and no finite animation running on screen, and fails after 20 seconds.
- `jumpOnScreen` in `tests/e2e/transcript-streaming-follow.spec.ts` lets a gliding row's step grow to twice the step before, because a loaded machine stretches single frames; under ten workers it read a 1.5 px jump where the row had slowed down.
- The harness keeps `MALINI_SHIP_DELAY_SCALE=0.1` from 0036.

## Consequences

- Nothing checks how fast the app is: a performance regression in the changed files list, like one in the transcript since 0035, shows up only by hand.
- A run takes three macOS jobs instead of four, and the scale spec shares its runner with another app.
- A slow machine makes a motion spec wait longer instead of cutting its window short.
- A fixed `waitForTimeout` stays only where a spec proves something does not happen for a while, such as a tooltip that must stay closed.
- `.agents/rules/frontend/testing.mdc` states both rules; no lint rule enforces them.
