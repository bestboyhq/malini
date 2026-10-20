# 0002 - One typed contract between the main process and the renderer

Status: accepted

## Context

The renderer shows content Malini does not control: agent transcripts, Markdown, diffs and images from the user's repositories.
Electron's safe defaults for that are `contextIsolation` and `sandbox`, which leave the renderer no Node access at all.
The renderer still needs well over a hundred operations from the main process, and a hand-written IPC channel per operation drifts out of sync on one side or the other.

## Decision

- Every window runs with `contextIsolation` and `sandbox` on and `nodeIntegration` off (`src/main/window.ts`).
- Commands (`<domain>.<verb-kebab>`) and events (`<domain>:<event-kebab>`) are declared once, with their argument, result and payload types, in `src/contract/commands.ts` and `src/contract/events.ts`.
- They travel over two IPC channels, `malini:invoke` and `malini:event` (`src/contract/ipc.ts`).
- The preload exposes `window.malini`, typed from the contract.
  The main process registers handlers with `CommandRegistry.define` and emits through the `EventBus`.
- In the renderer, only infrastructure services call it, through `invoke` and `onPlatformEvent` in `$shared/port`.
  The automated tiers swap it for one fake per domain in `$shared/port/fake`.

## Consequences

- A new capability is one contract entry, one `define`, and one infrastructure service, with types checked on both sides.
- Renderer code and its tests run without Electron, against the fakes.
- A failure crosses the boundary as a `CommandFailure` with a `kind` and `code` the renderer can branch on.
- Enforced by `pnpm check`, which type-checks both processes against the contract; by `src/main/modules.test.ts`, which fails when the registered commands differ from `COMMAND_NAMES`; by a dev boot that throws on the same mismatch; and by `@malini/desktop/domain-boundaries`, which limits who may import `$shared/port`.
