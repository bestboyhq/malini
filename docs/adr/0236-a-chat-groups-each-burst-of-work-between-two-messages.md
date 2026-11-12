# 0236 - A chat groups each burst of work between two messages

Status: accepted

## Context

0223 kept one activity group open across the status messages between tool calls, and 0230 kept that rule but drew a running turn flat until it ended.
So a finished turn read as one line, such as "Edited 3 files · read 4 · 47 commands", with every status message hidden inside it, and a running turn showed every tool call and thought as a row of its own.
The user marked the transcript of a real turn: the agent's messages in blue stay, and the tool calls and thoughts between two of them, in red, are one group each.
In their words: "right before showing the next blue type of text, we should just group together tool calls between this blue text and the previous blue text and that's it it's really that simple".
And: "currently I think we're grouping or wrapping entire run history, which is exactly not what I meant."

## Decision

- `groupRunTimeline` in `apps/malini/src/lib/chat/presentation/activity-group.ts` ends a burst at every row that is not a tool call, command, file edit or thought: an assistant message, the prompt, a plan, an approval, a question, a compaction, a handoff, a subagent or the started-workstreams card.
- A burst of two or more rows with at least one tool call, command or file edit becomes one activity group, its thoughts included, wherever they sit in it.
- A lone tool call and a burst of only thoughts stay rows of their own.
- An assistant message never goes inside a group.
- `groupedTimelineItems` in `chat-message-list/timeline-derivations.svelte.ts` groups an open run too, as `groupRunTimeline(items, !replying)`: its last burst stays flat, one row per step, while the agent works on it.
- `TranscriptRun.svelte` sets `replying` once a streaming reply shows text, so that last burst folds as soon as the next message starts, not when it lands.
- Once the turn ends, the last burst folds too.
- Kept: the group's line counts only its tool calls, commands and files (0223); `ExpandMark` opens it; `withPendingRows` never draws a step twice; `StepRows.svelte` mounts an opened group's rows as they come near.
- Kept: turns before the last two fold their whole work into one line (0174), and `ActivityMessageRow.svelte` still draws a status message inside that fold.

## Consequences

- Every status message the agent writes stays in view, during the turn and after it, with one line for each burst of work above it.
- The step the agent works on now shows as a row the moment it lands, as 0230 wanted, and its burst folds once the agent writes again.
- A turn that writes a message before every tool call, with no thought between, gets no group at all.
- `activity-group.test.ts` checks that a message ends a group, that thoughts at either end of a burst join it, that a lone tool call stays a row, and that an open run leaves its last burst flat.
- `tests/e2e/live-work-group.spec.ts` checks, on the fake bridge's `TOOL_STREAM:8:6 NARRATED:3`, a message every three reads, that a running chat shows "Explored 3 files" above its message while the next reads stay rows, and that the ended turn shows three groups between four messages.
- The same spec checks, on `STREAM:40 READS:2`, that the reads and the command before a streaming reply are one group while it streams.
- `tests/e2e/thinking.spec.ts` checks that the thoughts of a turn sit inside its group.
