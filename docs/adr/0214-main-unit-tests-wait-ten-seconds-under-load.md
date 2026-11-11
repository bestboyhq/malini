# 0214 - Main unit tests wait ten seconds under load

Status: accepted

## Context

Vitest's `vi.waitFor` gives up after one second by default, polling every 50 ms.
The `main` project in `apps/malini/vitest.config.ts` runs main-process tests against the real `node:sqlite` and filesystem (0027), its files in parallel across vitest's workers, and its tests called `vi.waitFor` 104 times in 20 files when this was written.
When the whole suite ran at once, waits that pass alone ran past that one second and flaked.
A `timeout` at each of those calls would show every wait but repeat one number a hundred times, and a review of this change called the patch hidden: a call that reads as one second waits ten.
The `renderer` project runs pure functions in one worker (`maxWorkers: 1`) under vitest's 5 second `testTimeout`, so a 10 second wait there would outlast its own test.
`.agents/rules/frontend/testing.mdc` already sizes an e2e timeout for the product's slowest refresh under load, not the typical case.

## Decision

- `apps/malini/vitest.setup.ts` replaces `vi.waitFor` with a wrapper that defaults `timeout` to 10,000 ms (`UNDER_LOAD_TIMEOUT_MS`).
  An options object keeps its own `timeout` and `interval`, and a number stays the timeout, as vitest reads it.
- `apps/malini/vitest.config.ts` loads it with `setupFiles: ['./vitest.setup.ts']` in the `main` project only, whose `testTimeout` stays 30 seconds.
- The `renderer` project loads no setup file, so its `vi.waitFor` keeps vitest's one second, and hyper-ui's project is unchanged.
- A wait that should end sooner passes its own `timeout`, as `src/main/modules.test.ts` does with `{ timeout: 2_000 }`.
- `.agents/rules/frontend/testing.mdc` says so where it lists main-process tests.

## Consequences

- Waits that are slow only under load stop flaking, and a wait that never passes fails after 10 seconds instead of 1.
- The same call reads differently by project: in a `main` test, `vi.waitFor` with no `timeout` waits up to ten seconds, which only this record and the testing rule say.
- The `main` project's `testTimeout` must stay above 10 seconds, or a test times out before its wait does.
- A renderer test that needs more than a second passes its own `timeout`, below its 5 second `testTimeout`.
- Enforced by `apps/malini/vitest.config.ts`, whose `main` project lists `vitest.setup.ts` in `setupFiles` and whose `renderer` project lists none, and by the line in `.agents/rules/frontend/testing.mdc`.
  Nothing else enforces it: no test fails when the patch goes, only the flakes come back.
