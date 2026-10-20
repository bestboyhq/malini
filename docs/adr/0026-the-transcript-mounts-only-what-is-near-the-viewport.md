# 0026 - The transcript mounts only what is near the viewport

Status: accepted

## Context

`ChatMessageList` mounted every run of a chat, and inside each run up to 200 timeline rows.
On a busy chat (30 turns, about 6,000 events) that meant 816,000 DOM nodes, a 1.9 million pixel scroll height and 2.6 GB of heap, and the renderer crashed while scrolling up.
The user asked for a transcript that opens a busy workstream instantly without cutting off old messages.
Paging the data (0024) bounds what loads; it does not bound what renders once the whole history is in.

## Decision

- One `IntersectionObserver` on the scroller (`chat-message-list/transcript-window.svelte.ts`) mounts runs, and rows inside large runs, within about 1.5 viewports above and below.
  The last run, and a run whose prompt is being edited, always mount.
- An unmounted run (`TranscriptRun.svelte`) or row (`TranscriptRow.svelte`) is a placeholder of its remembered height, or an estimate from `transcript-estimates.ts`, labelled with its prompt text and keeping `data-run-id`.
- Heights are kept per chat in memory and run heights persist in `localStorage` under `malini.chat.transcript-heights:v1`, at most 50 chats, cleared when a chat is forgotten.
- Native scroll anchoring holds the reader's position when a placeholder's height is corrected; `transcript-scroll.svelte.ts` accepts the browser's position in reader mode unless the browser clamped it.
- A hover card closes when an ancestor of its trigger scrolls, so content scrolling under a still pointer never captures the wheel.

## Consequences

- The DOM stays near 1,000 nodes on the busy chat, however long it gets, and every message stays reachable by scrolling.
- Find in page only sees mounted runs.
- State kept inside a row's component, such as an expanded tool card, resets once it scrolls far away.
- No code may set `overflow-anchor: none` on the transcript or measure rows that are not mounted.
- Enforced by `tests/e2e/transcript-virtualization.spec.ts`, which wheels a long chat to its first prompt and checks the row under the pointer moves exactly with the wheel, and by `tests/e2e/transcript-performance.spec.ts`, whose budgets fail above 20,000 DOM nodes or 300 MB of heap.
