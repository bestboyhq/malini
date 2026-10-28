# 0109 - A lead chat reads as a timeline

Status: accepted

## Context

A lead chat showed the same transcript as a repository chat, every tool call included, and the user "was seeing a lot of details in the chat that I don't care about at all".
Of three redesigns, the user kept A's chat with "the questions ... at the bottom" and C's timeline: "when you create a high-level chat, you probably expect to work with something like a timeline", since a lead is the same conversation at another resolution: "a work stream will ... contain tool calls ... and chat level conversation should just have different resolution".
They asked that "every single event that happened in the past and it's not happening right now should be less vivid", for visuals over text, for pictures that open "in a bigger resolution", and for the workstreams list at the top right to stay, with the decisions beside it.
In C's timeline the user's own entries had white dots, which read as a meaning nobody gave them.
The transcript had no time per message: envelopes carried a `seq`, and only the event log knew when an event happened.

## Decision

- `WorkstreamLayout.svelte` passes `timeline` to `ChatSurface.svelte` for a workstream with a `scope`, which then shows `LeadTimeline.svelte` instead of `ChatMessageList`; the composer, the queue, the job tray and the requests of started work stay as they are.
- `leadTimeline` (`src/lib/chat/presentation/lead-timeline.ts`) projects the session's runs into one line per thing that happened:
  - your prompts; the reports of started workstreams (0105), with up to four of their pictures; and notes Malini sent;
  - the lead's tool calls between two messages folded into one line, such as **Lead worked · 4 steps**, whose **Show work** lists the steps by their descriptions;
  - what the lead did through Malini: started, sent with the delivery's state (0104), archived, ran a job, rewrote the plan (0108);
  - each decision made, at the time it was made, with **Change** (0107);
  - an approval the lead waits on, as its card, and a turn that paused, failed or was cut by a quit;
  - the lead's latest message in full, each earlier one folded to its `Outcome:` line.
- `timelineRows` starts each day with its label and shows a time only when it changes.
- Every dot is grey; **Now**, in the brand color with a ring, marks the work running now, an approval waiting on you, **Lead is thinking**, and each started workstream on a turn (`leadWorkQuery`).
- Lines of earlier turns fade to half opacity and come back on hover or focus.
- A report's pictures open full size in `MediaViewer.svelte`, which flips through them.
- Envelopes carry their time: `LiveEventEnvelope.emittedAt` (`src/contract/agent.ts`) is stamped by the runtime on live events and by the lifecycle on the ones it makes up, and read from `agent_events.emitted_at` for stored and packed ones, and the renderer keeps it as `at` on prompts, messages and approvals.
- The top right list of 0076 keeps the started workstreams, and **Your decisions** (`LeadDecisionsList.svelte`) joins it under them (`WorkstreamPage.svelte`).
- The composer of a lead says "Ask the lead anything…", or "Answer in your own words, or ask the lead anything…" while a decision is open, and `InlinePromptEditor` reads its placeholder through a function so a change shows at once.

## Consequences

- A lead reads as what happened and what happens now, at a glance, and a repository chat keeps every tool call.
- A lead's earlier messages are one click from full, its steps one click from their descriptions, and its tool output and thinking no longer show at all.
- A new kind of Malini call needs its own line in `actionEntry`, or it folds into the work line.
- Every envelope crosses to the renderer with its time, which only the timeline reads.
- Enforced by `lead-timeline.test.ts` (folding, Malini lines, reports, decisions by time, quiet stops, only the newest turn vivid, undone turns left out, day labels, Outcome lines, approvals), `event-packs.test.ts`, `lifecycle.test.ts` and `runtime.test.ts` (times on envelopes), and `tests/e2e/lead-timeline.spec.ts`, `lead-chats.spec.ts` and `merge-queue.spec.ts`.
