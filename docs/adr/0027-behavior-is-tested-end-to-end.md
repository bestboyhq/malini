# 0027 - Behavior is tested end to end

Status: accepted

## Context

The renderer had three automated tiers below e2e: Node tests against a fake platform (`$shared/port/fake`, one fake per domain, which 0002 introduced), jsdom component tests (`*.browser.test.ts`), and source contracts that read a `.svelte` file's text.
During the transcript performance work these tiers failed far more often for their own scaffolding than for real bugs: jsdom lacked `IntersectionObserver`, two spies on one method recursed until the worker ran out of memory, fake layouts needed patching for placeholders, and about eight source contracts broke on refactors that changed no behavior.
The e2e suite, driving the built app against the fake agent bridge, caught every real regression in the same work, including a footer drawn over streamed text that no unit test could see.
The user asked to stop maintaining tests that give false failures and to test behavior end to end in a simulated environment instead.
Pure functions and the main process on real SQLite kept their value: a unit test caught the preloader keeping an over-budget run, and the incremental tokenizer was checked against 1,380 prefixes.

## Decision

- Behavior is tested in `apps/malini/tests/e2e/*.spec.ts`: Playwright drives the built app, with `tests/e2e/fixtures/fake-bridge.cjs` standing in for Claude Code and `gh`/`docker` stubs from `tests/e2e/harness.ts`.
- Vitest keeps two kinds of test: pure functions with no mounted component, effects or platform, and main-process code against the real `node:sqlite` and filesystem, stubbing only Electron, the OS and the network.
  A string-to-DOM transform such as markdown rendering may borrow jsdom's parser for its file.
- No test mocks or fakes malini's own modules, mounts a component outside the app, or reads a source file's text.
- The fake platform (`$shared/port/fake`, `setPlatformForTest`, the `PUBLIC_PLATFORM=fake` browser mode), its testkits, the `renderer-browser` vitest project, its jsdom setup and hyper-ui's jsdom component tiers are deleted.
  This reverses the clause of 0002 that swapped `window.malini` for per-domain fakes; the rest of 0002 stands.

## Consequences

- A test failure means the product broke, not the scaffolding.
- The e2e suite is slower (about 15 minutes) and is the tier that guards wiring, so new features add or extend a spec rather than a unit test.
- A scenario the fake bridge cannot produce needs a new directive in `fake-bridge.cjs` before it can be tested.
- Enforced by `apps/malini/vitest.config.ts`, which has no jsdom project, and by the deletion of `$shared/port/fake`, so a renderer test cannot swap the platform; the rest is review against `.agents/rules/frontend/testing.mdc`.
