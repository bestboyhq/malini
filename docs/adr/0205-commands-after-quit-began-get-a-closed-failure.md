# 0205 - A command that arrives after quit began gets a closed failure

Status: accepted

## Context

0002 has the main process answer the renderer through `CommandRegistry` and emit through the `EventBus`, with a failure crossing as a `CommandFailure`, and it says nothing about quitting or about a listener that throws.
At quit, `CommandRegistry.close()` waited for the commands in flight and then left every later command unanswered: `handle()` returned a promise that never settled, so the renderer that sent one waited until its window died.
On the bus, a window forwarder, observer or listener that threw skipped every one after it and threw into the code that emitted, so one broken listener could keep the event log, the bus's only observer, from hearing an event.
In the preload, an unsubscribe that ran twice deleted its channel's listener set even after a later listener had made a new one, so that listener heard nothing.
`ConfirmedShutdown.run`, which both `app.shutdown-gracefully` and `Modules.shutdown()` call, marked itself done as it started, so a second call returned at once while the first still reclaimed containers, and nothing reclaimed what started after it.

## Decision

- Quit runs in this order in `src/main/index.ts`: `will-quit` sets `shuttingDown`, which stops recording command failures in the diagnostics log, and calls `quit()`, which awaits `Modules.shutdown()`, races `commands.close()` against `COMMANDS_CLOSE_BUDGET_MS` (5 seconds), then closes the database and calls `app.exit()`.
  `Modules.shutdown()` in `src/main/modules.ts` stops the platforms, aborts dependency installs, stops chat, waits for automations to settle, releases the lid hold, then runs `app.shutdownGracefully()`, flushes usage data and saves the window state.
- `CommandRegistry.handle()` in `src/main/ipc/registry.ts` answers a command that arrives after `close()` with `{ ok: false, failure }` and never runs its handler.
  The failure is `{ name: 'CommandRegistryClosed', message: '<command> came in after Malini began to quit', code: null, kind: 'closed', command }`, and `invoke()` returns that message as its `error`.
  A command that arrives while `Modules.shutdown()` still runs is not refused: it runs, and `close()` waits for it.
- The closed path skips `report()`, so no `observe` or `observeFailures` observer hears it: neither the diagnostics log nor the error names that `src/lib/app/platform/usage-data.ts` sends to Logdash.
  In the main process it resolves and never throws; in the renderer, the preload's `invokeCommand` throws the failure like any other, and `invoke` in `$shared/port/invoke.ts` rejects with `commandRejection`.
- `call()`, the main process calling its own commands from automations, shipping, the agent's platform tools and the brain, stays ungated and untracked: `close()` neither refuses it nor waits for it, and `Modules.shutdown()` stops those callers before the registry closes.
- `createEventBus` in `src/main/events.ts` runs the window forwarder, each observer and each listener inside `deliver()`, which catches a throw and logs `malini: a listener of <channel> threw:` through `console.error`, and the rest still run.
  `captureMainProcess` records that line as an error in the main diagnostics log.
- The preload's `subscribe` in `src/preload/index.ts` returns an unsubscribe that deletes only its own callback from its own set and never deletes the channel's set, so running it twice changes nothing.
- `ConfirmedShutdown.run` in `src/lib/app/platform/graceful-shutdown.ts` keeps the run in flight: a call while it runs waits for it and returns its outcome with `alreadyReclaimed: true`, and a call after it finished runs again and reclaims the containers and closes the agent runs started since.

## Consequences

- A renderer call that comes too late fails at once with a named failure instead of waiting forever.
- Commands sent during `Modules.shutdown()` still run against platforms that are stopping, and `close()` gives them at most 5 seconds before the database closes.
- The main process records nothing about a command that came too late, so one lost to quit leaves no trace there.
- A throwing listener now shows only in the main diagnostics log; before, it failed its emitter, which could reach Logdash as a failed command or an uncaught exception.
- An empty listener set stays in the preload's map, at most one per channel.
- Quit waits for a confirmed shutdown already in flight, within that run's own budget, instead of going on while it still reclaims.
- What must stay true: `handle()` checks `closed` before it runs or reports anything, and every delivery on the bus goes through `deliver()`.
- Enforced by `src/main/ipc/registry.test.ts` ('closes once every command in flight has replied, and refuses later commands without running them': the exact failure, the `invoke` error and the handler not run), `src/main/events.test.ts` ('runs every listener when one throws, and records the throw as an error'), `src/preload/index.test.ts` ('keeps a later listener when an earlier unsubscribe runs twice'), `src/lib/app/platform/graceful-shutdown.test.ts` ('reclaims, closes runs, joins a shutdown in flight, and reclaims what started since') and `src/lib/app/platform/graceful-shutdown-command.test.ts` ('returns the outcome the renderer reads').
  Nothing tests that observers never hear a closed failure, that `call()` still runs after `close()`, or the order in `quit()`.
