# 0256 - Quit never waits on Electron's preload code cache

Status: accepted

## Context

Electron 44 caches the V8 code of a sandboxed preload in `<sessionData>/Code Cache/electron-preload/<hash>.cache`.
After a cold compile, `electron::preload_code_cache::WriteToDisk` writes the file from a `BEST_EFFORT`, `SKIP_ON_SHUTDOWN` thread pool task, and every e2e launch is cold because each test gets a new profile.
On pull request #212, `merge-queue.spec.ts` failed in `e2e on macOS 1/5` with `the app did not quit within 15000 ms`, after the test itself had passed.
Its sample, symbolicated with Electron 44.4.0's Breakpad symbols, shows the main thread in `TaskTracker::CompleteShutdown` and two `ThreadPoolBackgroundWorker` threads in `WriteToDisk`, at `close` in `base::WriteFile`.
This is the same throttled background I/O as ADR 0125, through a store that no Chromium feature or Electron option turns off.
Malini's only preload, `out/preload/index.js`, is 1.5 KB, so its cache saves almost nothing.

## Decision

`src/main/index.ts` calls `blockPreloadCodeCache(app.getPath('sessionData'))` from `src/main/preload-code-cache.ts` before the app is ready, next to `CHROMIUM_FEATURES_THAT_STALL_QUIT`.
It puts an empty file where Electron makes the `electron-preload` folder, and first removes a folder an earlier version left there.
Electron cannot make the folder, so the write fails at `open` and no thread holds a file open at quit.
It applies to every launch, since a busy Mac throttles the same thread.

## Consequences

Quit no longer waits on a throttled preload cache write, in CI and on a busy Mac alike.
Each window load compiles the preload again, which costs less than a millisecond at its size.
A preload that grows large makes this cost real, and a later Electron that moves the cache or adds an option to turn it off makes the file unneeded.
`tests/e2e/window.spec.ts` fails when `Code Cache/electron-preload` is not a file after a quit, and `src/main/preload-code-cache.test.ts` covers a new profile and an old one.
