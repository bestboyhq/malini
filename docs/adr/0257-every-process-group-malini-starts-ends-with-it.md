# 0257 - Every process group Malini starts ends with it

Status: accepted

## Context

ADR 0256 quits a background app through its normal quit once its launcher is gone, so a main thread that hangs or a quit that never ends still leaves the app running.
Malini starts the agent bridge, shell runs, `runWithTimeout` commands and installs in process groups of their own, so a group kill of a crashed or killed Malini never reaches them, and the user's own app leaves them behind too.
On a closed stdin the bridge waited for its in-flight turn, so it kept running a turn that nobody read, and resuming that session after a restart could start a second agent on it.
macOS has no parent-death signal, and its `/bin/bash` 3.2 returns 1 from a `read -t` that times out, the same status as at end of file.
The e2e harness checked nothing about the processes an app started, so a stub that outlived its test ran for four days unnoticed.

## Decision

- `startReaper` in `src/main/process/reaper.ts` runs at boot in every Malini and starts `/bin/bash` as `malini-reaper` in a process group of its own, its stdin a pipe that only Malini holds and never closes.
- `endWithMalini(child)` writes the pid of each process group Malini starts to that pipe.
  The bridge (`src/lib/chat/platform/agent/process.ts`), shell runs, `runWithTimeout` and the install runner wrap their `spawn` in it.
  `trySpawnDetached`, which opens other apps, does not.
- End of file on the pipe means Malini is gone, however it died.
  The reaper then sends SIGTERM to every listed group that still exists, waits up to 3 seconds and sends SIGKILL to what is left.
- It reads with `read -t 5` and takes a read that returns in under 4 seconds without a line as end of file.
  Every 5 seconds it drops the groups that no longer exist, so it never signals a pid that was reused.
- With `MALINI_BACKGROUND_WINDOW=1` it also gets the launcher's pid.
  Once Malini's parent is no longer the launcher and Malini is still the reaper's parent 15 seconds later, the reaper sends SIGKILL to Malini and its group.
  The `process.ppid` check of ADR 0256 still runs first and quits cleanly within a second.
  A background app that leads its process group also has that group on the list, so its helpers and plain children end with it.
  The user's own app leaves its group alone, because the helper that `app.relaunch()` starts at exit lives there.
- The bridge, `packages/agent-bridge/src/cli.ts`, sends SIGTERM to the process group it leads once its stdin closes, so `claude` and its tools stop with it.
  A bridge that leads no group, as in its unit tests, still drains its commands first.
- The e2e harness takes the app's process tree before `quit()`, fails the test softly when one of those processes still runs 5 seconds after the app is gone, and kills it.
  Every e2e stub that waits in a loop uses `waitWhile` from `tests/e2e/harness.ts`, which exits once its parent is gone.

## Consequences

- A crashed, killed or hung Malini, background or not, no longer leaves a bridge, a turn, a shell run or an install running.
- Quitting Malini now also stops a `claude update` or an install that is still running.
- Each Malini runs one more process, an idle reaper; only in background mode does it start `ps` every 5 seconds.
- A reaper that dies is not started again: Malini logs `the reaper stopped`, and the groups it starts after that end with nothing.
- A new process group must go through `endWithMalini`: `no-restricted-syntax` in `apps/malini/eslint.config.mjs` fails on `detached: true` outside an `endWithMalini(...)` call, except in `detached.ts` and `reaper.ts`.
- `apps/malini/tests/e2e/killed-run.spec.ts` launches the app under a plain `sh` runner with no inspector.
  It fails when a process of the app still runs 20 seconds after that runner is killed, when an app that hangs survives the runner by 40 seconds, and when a bridge group mate that ignores SIGTERM outlives a SIGKILL of the app.
- `packages/agent-bridge/src/__tests__/cli.test.ts` fails when a bridge that leads its group leaves a group mate running after its stdin closes.
- The harness check on every `quit()` fails each e2e test whose app leaves a process behind.
