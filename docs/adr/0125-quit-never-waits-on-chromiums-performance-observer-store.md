# 0125 - Quit never waits on Chromium's performance observer store

Status: accepted

## Context

Electron 44's Chromium creates `declarative_performance_observer.db` in every storage partition, the user data folder and `Partitions/malini-browser`, from a best-effort task that also blocks shutdown.
That task runs on a background-priority thread, and on a busy disk macOS throttles that thread's I/O, so its `fsync` can take more than 15 seconds.
After `app.exit()`, Chromium's `TaskTracker::CompleteShutdown` waits for it, and the process does not exit.
In CI this was the `the app did not quit within 15000 ms` failure: 15 of the 20 quit stalls in 300 CI runs, on `main` and on branches alike.
Samples symbolicated with Electron's Breakpad symbols show the main thread in `CompleteShutdown` and the background workers inside `DeclarativePerformanceObserverStore::Backend::InitOnDbSequence`, at `fsync` or still starting at background priority.
Malini serves no page that uses the Declarative Performance Observer API.

## Decision

`src/main/index.ts` appends `--disable-features=DeclarativePerformanceObserver` before the app is ready, from `CHROMIUM_FEATURES_THAT_STALL_QUIT`.
Chromium then never creates the store, and shutdown has no background `fsync` to wait for.
When a test's app still does not quit, the e2e harness samples every process in its tree, the GPU, network and renderer helpers too, into `quit-stall-sample-<pid>.txt` next to the main process's `quit-stall-sample.txt`.

## Consequences

Quit no longer waits on a throttled background write, in CI and on a busy Mac alike.
A `declarative_performance_observer.db` an earlier version left in a data folder stays there, unused.
An Electron bump that renames the feature or adds another store that blocks shutdown brings the stall back; `tests/e2e/window.spec.ts` fails when the store's files appear in the user data folder after a quit.
The rarer stall, 5 of the 20, is not fixed: closing the window waits on a synchronous `DestroyCompositorFrameSink` call that the GPU process never answers, and the helper samples exist to show why on its next occurrence.
