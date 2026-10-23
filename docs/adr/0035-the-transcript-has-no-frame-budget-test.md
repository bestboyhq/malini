# 0035 - The transcript has no frame budget test

Status: superseded by 0046

## Context

`tests/e2e/transcript-performance.spec.ts` held a busy chat to millisecond budgets: settled within 500 ms of a cold open, no frame over 100 ms, none over 50 ms while wheeling to the top.
It passed on a developer Mac with room to spare (settled at 165 ms, worst frame 42 ms) and failed every CI run since it landed, on its own pull request and on `main`, even alone on a runner (settled at 1,741 ms, worst frame 651 ms).
A `macos-latest` runner is three M1 vCPUs in a virtual machine, and the same commit's time to a ready chat varied from 388 ms to 1,343 ms between runs, so a fixed budget there measured the runner, not the app.
The user asked to delete the failing performance test and move on.

## Decision

- `tests/e2e/transcript-performance.spec.ts` is deleted.
- 0024 and 0026 still name it as an enforcer; their behavior stays checked by `tests/e2e/transcript-paging.spec.ts` and `tests/e2e/transcript-virtualization.spec.ts`.

## Consequences

- CI's e2e shards no longer fail on a slow runner's frame times.
- Nothing checks the transcript's cold-open, scroll or streaming frame times, its DOM node count or its heap, so a performance regression shows up only by hand.
- `tests/e2e/changed-files-performance.spec.ts` keeps its two-second budget, which CI meets.
