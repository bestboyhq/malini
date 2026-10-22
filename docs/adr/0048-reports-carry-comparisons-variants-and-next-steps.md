# 0048 - Reports carry comparisons, variants and next steps

Status: accepted

## Context

Users ask an agent to change something they can see, and then hunt for the difference between two screenshots, often a detail a few pixels wide.
They also ask for options, and the options landed in the chat or the browser in a different shape every time, with no record of which one was picked or why.
The report's `Deferred:` bullets showed in a warning colour with nothing to click, so they read as an alarm rather than as the work left to do.
Report images reach the renderer over `malini-image://`, which has no CORS, so a canvas that draws them is tainted and cannot read their pixels; turning CORS on would let any page in the browser panel read workstream files.

## Decision

- The report protocol in `packages/agent-bridge/src/claude/instructions.ts` gains three image labels and one note label, and `parseTurnReport` in `apps/malini/src/lib/chat/domain/turn-report.ts` reads them from the alt text:
  - `![Before: …](path)` and `![After: …](path)` become one `comparison`, as pictures or as recordings (`.mp4`, `.m4v`, `.mov`, `.webm`); `#t=<seconds>` on the After recording marks a moment.
  - `![Variant A: Name - note](path)`, two or more, become `variants`.
  - `Next:` bullets, and the older `Deferred:` ones, become next steps; `Changed:` and `Verified:` stay one line each.
- A pick is a prompt Malini writes and reads back, `Go with variant B (Name).` with an optional `Why:` line (`chat/domain/variant-pick.ts`); the transcript derives the decision trail from those prompts, and the ship context turns them into the pull request's `## Decisions` section, so nothing new is stored.
- The pixel diff runs in the renderer: `image-pixels.service.ts` reads the bytes through `repositories.read-workstream-image`, decodes them with `createImageBitmap` into an `OffscreenCanvas`, and the pure `imageChanges` in `chat/domain/image-changes.ts` finds the changed areas; `malini-image://` keeps no CORS.
- **Do it now** sends a next step through `submitPromptCommand`, which queues it when the chat is busy; **Scratchpad** reaches the scratchpad domain through an `onsavetoscratchpad` prop the app layout passes to `ChatSurface`.

## Consequences

- The agent decides what to compare and what to offer; a report without the labels renders as before.
- Changing a label or the pick prompt is a protocol change: `instructions.test.ts`, `turn-report.test.ts` and `variant-pick.test.ts` pin both ends, and `tests/e2e/report-media.spec.ts` drives the comparison, the recordings, a pick and both next-step actions through the fake bridge's `REPLY_FILE:` reply.
- A diff of two 2x screenshots costs a decode and one pass over the pixels on the main thread, and its mask stays in memory as a PNG object URL for the session.
- Pictures of different sizes get no Diff mode and no changed areas, only Wipe and Flip.
