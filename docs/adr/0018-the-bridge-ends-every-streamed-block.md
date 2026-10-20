# 0018 - The bridge ends every streamed block

Status: accepted

## Context

The renderer draws a live row for every streamed thought, answer and tool input, and drops it only when the block's final message arrives or the run ends.
Claude Code retries a request that fails mid-stream and writes only the attempt that succeeds, so the failed attempt's blocks never get a final message.
The user saw two "Thinking" rows stacked in one chat: the first was a thought from a stream that died, frozen at the bottom of the run for three more minutes, and its text exists in neither Malini's database nor Claude Code's transcript.
Recorded through a proxy that cuts the API stream: an overload or a dropped connection ends the dead stream with `message_stop` and no `message_delta`, then `system/api_retry`, then a new `message_start`; a stream cut during tool input falls back to a non-streaming request with no `api_retry` at all, and the fallback's blocks carry another message id.
The bridge also paired a final block with its stream by counting blocks per message, so one block Claude Code never finalized would shift the id of every block after it.

## Decision

- The bridge event `stream.discarded { runId, contentIds, toolCallIds }` drops streamed blocks that will never get a final message; the bridge protocol is version 27.
- `ClaudeTranscript` (`packages/agent-bridge/src/claude/transcript.ts`) keeps every streamed text, thinking and tool block open until its final event and discards whatever is still open on the first of:
  `message_stop` without a `message_delta`, `system/api_retry`, a new `message_start`, a main-thread `assistant` message from another message id, and the turn's `result`.
- A final text or thinking block takes the id of the streamed block of its kind in the same position, and falls back to counting only for a message that never streamed.
- The event is ephemeral like the deltas; main forwards it, and the streaming store drops the listed blocks and tool inputs (`streaming.store.svelte.ts`).
- The renderer never guesses which live block is dead; the run's end still clears what is left as the last net.

## Consequences

- A retried or fallen-back request leaves only the attempt Claude Code kept on screen, from the moment the dead stream stops.
- Every streamed block ends exactly once, as a final event or a discard, so a live row cannot outlive its stream.
- A Claude Code behavior that ends a stream some other way is still caught, later, by the next message, the turn's result or the run's end.
- Enforced by `transcript.test.ts`, which replays the recorded `retriedStream` and `nonStreamingFallback` scenarios with each signal removed in turn and checks that every block streamed in every recorded scenario ends exactly once, by the `stream.discarded` tests in `streaming.store.svelte.test.ts` and `protocol.test.ts`, and by `pnpm check`, which fails on a stale generated protocol.
