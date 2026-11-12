# 0230 - A chat groups its tool calls once the turn ends

Status: superseded by 0236

## Context

0223 grouped every run, the running one included, so a chat at work showed one shimmering "Exploring 4 files" line with its newest status message beside it, and each tool call hid behind that line as it ran.
The user read that as a misunderstanding: "Feels like we're grouping chat tool calls, etc., during the run. So that's misunderstanding. We should be grouping the last run tool calls only once it finishes."
Before 0223 the last run never grouped at all: `groupedTimelineItems` kept it flat through `shownLinear` even after it ended, and a 200-event window kept a long live run cheap.
The rest of 0223 still holds: a group spans the status messages and thoughts between tool calls, and an older turn folds into one flat list.

## Decision

- `groupedTimelineItems` in `chat-message-list/timeline-derivations.svelte.ts` returns an open run's timeline flat, folding only its subagents and started workstreams (`groupSubagents(foldStartedWorkstreams(items))`).
- A run is open while `run.terminal === null && !run.turnEnded`, the same test `RunStatusLine.svelte` uses for its timer; a turn that resumes after `turn.resumed` draws flat again until it ends.
- Once the turn ends, `groupRunTimeline` groups the run as 0223 set it out:
  - one activity group stays open across the assistant messages and thoughts between two tool calls, commands or file edits;
  - a message or thought before the first tool call or after the last one stays a row of its own;
  - compactions, plans, approvals, questions, handoffs and subagents end a group;
  - the group's line counts only its tool calls, commands and files.
- The live group parts go: `liveVerb` and `latestMessage` on `ActivityGroup`, the `live` prop, shimmer and newest-message line (`chat-activity-group-latest`) of `ChatActivityGroup.svelte`, and `workingRow` in `TranscriptRun.svelte`.
- Kept from 0223:
  - `ExpandMark` opens a group and a fold, with the lead kind's icon at rest;
  - `ActivityMessageRow.svelte` draws a status message inside an opened group;
  - `withPendingRows` never draws a streaming tool call twice;
  - `foldRunWork` lists an older turn's steps one level deep;
  - the 200-event window stays gone;
  - `StepRows.svelte` mounts an opened group's rows as they come near.

## Consequences

- While the agent works, each tool call, status message and thought shows as its own row the moment it lands.
- When the turn ends, the rows between the opening line and the answer fold into one line per burst of work, so the transcript above the answer gets shorter at that moment.
- A long live run draws every row it has, as the last run did before 0223, now without a window; `transcript-streaming-follow.spec.ts` checks that a tool row in a 240-step run stays still while later steps stream in below it.
- `tests/e2e/live-work-group.spec.ts` checks, on the fake bridge's `TOOL_STREAM … NARRATED`, that a running chat shows each read and status message and no group, then one "Explored 8 files" group with the opening line and answer outside once the run ends, and seven status messages inside it.
- `activity-group.test.ts` checks the grouping rules of a finished run, and `transcript-round-fold.spec.ts` checks that an older turn's fold holds no group.
