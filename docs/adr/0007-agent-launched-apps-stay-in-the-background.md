# 0007 - Apps that agents launch stay in the background

Status: accepted

## Context

Agents prove a change by launching malini on the same machine the user is working on.
A window that appears, takes focus or adds a Dock icon interrupts the user, and their keystrokes can land in the test app.

## Decision

- `MALINI_BACKGROUND_WINDOW=1` places the window so one pixel column shows at the right edge of the rightmost display, as a `desktop` window behind every other one.
- In that mode `show` is `showInactive`, `focus` does nothing, the Dock icon is hidden, background throttling is off, and update dialogs stay silent.
- The e2e harness and `.agents/skills/test-malini-app/scripts/malini.mjs` set it, and any other launcher must too.
- Agents run neither `pnpm dev` nor `pnpm start` unless the user asks to watch.

## Consequences

- The user keeps working while agents test, and the app still renders at full speed.
- Code that shows a window, takes focus or opens a dialog has to respect `BACKGROUND_WINDOW` from `src/main/window.ts`.
- Enforced by `apps/malini/tests/e2e/window.spec.ts`, which fails when a test run's window covers more than one pixel column of any display.
