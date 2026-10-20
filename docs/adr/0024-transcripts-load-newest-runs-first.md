# 0024 - Transcripts load newest runs first

Status: accepted

## Context

Opening a busy chat (30 turns, about 6,000 events, 12.8 MB in SQLite) fetched every event in one `chat.list-events` call and applied the whole replay at once.
The renderer froze for 8.7 s, held 816,000 DOM nodes and 2.6 GB of heap, and crashed while scrolling up.
Tool outputs travelled whole, up to 1 MiB a frame, and every streamed delta was its own `webContents.send`.
Activating a chat also parsed its entire history a second time to rebuild the conversation seed.

## Decision

- `chat.list-event-page({ sessionId, afterSeq, beforeSeq, byteBudget })` returns the newest whole runs in `(afterSeq, beforeSeq)` that fit `byteBudget`, always at least one run, with `startSeq` and `complete`.
  Run sizes come from `agent_runs.event_bytes` and `agent_runs.first_seq`, kept by triggers on `agent_events` (migration 51), so a page never sums the session.
- The event stream (`event-stream.service.ts`) opens a chat on a 512 KiB tail page, then backfills older pages, oldest last, one per idle callback, until `complete`.
  `transcriptHistoryCompleteQuery` reads whether a chat's history is fully loaded.
  The preloader warms the same tail and hands it to the stream with `adopt`, so opening a warmed chat fetches only what is missing.
- A `tool.completed` output longer than 8 KiB travels as its first 8 KiB with `outputTruncated: true` and `outputLength`, in pages and live frames alike (`withToolOutputPreview`).
  The database keeps the whole output; `chat.tool-output({ sessionId, toolCallId })` returns it on demand.
- The `EventBus` holds ephemeral `chat:agent-event` frames for 16 ms and sends them as one array on `malini:event`; any persistent frame flushes them first, so order holds.
  The preload accepts a frame or an array of frames.
- `chat.list-events` stays whole and unpaged for callers that need every event.

## Consequences

- Opening a chat costs one page whatever its length; a page takes about 1 ms in the main process on the busy chat, so SQLite stays in the main process.
- Older events now arrive after newer ones, so the transcript and session aggregates must accept a page whose seqs all precede what they hold.
- Any code that renders a tool output must expect a preview and fetch the rest with `loadFullToolOutputCommand`.
- Enforced by `tests/e2e/transcript-paging.spec.ts`, which opens a long chat on its newest turn, scrolls to its first prompt, and checks the preview and the full output, and by `tests/e2e/transcript-performance.spec.ts`.
