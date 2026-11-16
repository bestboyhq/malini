# 0258 - Apps that agents launch quit once their launcher is gone

Status: accepted

## Context

ADR 0007 keeps the apps that agents launch out of sight, so nobody notices when one outlives its test.
Playwright's `_electron.launch` starts Electron with `detached: true`, in its own process group, so a test runner that is killed or timed out leaves the app running under launchd.
Malini's sandbox cannot stop a process that an earlier command started, so these apps pile up for days.
They also leave the Malini process tree, so the resource readout and the memory journal never count them.
The user saw two `Electron` processes at about 104% CPU each in Activity Monitor while Malini's own readout was not full.
The same path kept a fake `claude update` stub from an e2e run alive for four days, starting `sleep` about sixteen times a second.

## Decision

- When `MALINI_BACKGROUND_WINDOW=1`, `quitOnceTheLauncherIsGone` in `src/main/index.ts` reads `process.ppid` at launch and checks it every second.
- Once it changes, which happens when the launcher dies and launchd adopts the app, the app calls `app.quit()` and shuts down through its normal `will-quit` path.
- The e2e demo host, `tests/e2e/fixtures/demo-host.cjs`, does the same.
- Every e2e stub that waits in a loop, such as the fake `gh` device sign-in, the fake `claude update` and the fake `claude auth login`, also exits once `kill -0 "$PPID"` fails.
- A foreground app, the user's own or the `pnpm dogfood` window, never runs the check.

## Consequences

- A killed test run or agent no longer leaves an app, or a stub it started, running behind every window.
- A launcher must stay alive for as long as its app should run; the e2e harness and `.agents/skills/test-malini-app/scripts/malini.mjs` hold the app through Playwright, so they do.
- A background app that relaunches itself also quits, since its relaunched copy has a new parent.
- While a Node inspector client stays connected, Node waits for it to disconnect before the process exits, so a test of this check cannot keep Playwright attached.
- `tests/e2e/window.spec.ts` launches the app under a plain `sh` runner with no inspector, kills that runner and fails when the app is still running 20 seconds later.
