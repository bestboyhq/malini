# 0201 - A running chat folds its tool calls and status messages into one group

Status: accepted

## Context

An agent works in bursts: a few tool calls, a short status message, a few more tool calls.
`groupRunTimeline` in `activity-group.ts` ended its group at every assistant message, so each burst became its own "Explored 3 files" line with the status message between them.
The latest turn also skipped groups: `groupedTimelineItems` returned the flat timeline for the last run, and for every run that had once been the last, so a chat that was working showed one row per tool call.
The user asked: "we should collapse tool calls into groups. When you have a chat that is running it has tool calls, some stuff is happening, then it sends some quick status update message and then it calls another set of tools. I think we should collapse those tool call groups together."

## Decision

- `groupRunTimeline` keeps one activity group open across assistant messages: a message that sits between two tool calls, commands or file edits goes inside the group, in order.
- A message before the first tool call or after the last one stays a row of its own, so the opening line and the answer stay in view.
- Thoughts, compactions, plans, approvals, questions, handoffs and subagents still end a group, and a message next to one of them stays outside.
- `groupedTimelineItems` groups every run, the running one included: `shownLinear` and the `isLastRun` argument are gone.
- The group's line still counts only its tool calls, commands and files.
- While the run is open and no other row follows the group but messages, its line takes the present verb with a shimmer, such as "Exploring", and shows the newest status message beside it, as a thought's line shows its last step.
- Opened, `ChatActivityGroup.svelte` draws each status message as a compact row with a chat icon in the tool rows' icon column, in secondary text, never as a full reply.
- `withPendingRows` counts the rows inside a group as drawn, so a streaming tool call never shows twice.

## Consequences

- A running chat reads as one line per burst of work, and a status message folds into it as soon as the next tool call starts.
- The newest status message stays on the group's line while the run works, and every earlier one is one click away.
- A tool call that runs now sits behind its group's line, which turns to "Exploring" or "Running" while one is unfinished and keeps failures visible below it.
- `activity-group.test.ts` checks that messages between tool calls stay in one group, that a leading or trailing message stays out, and that every other row still breaks a group.
- `tests/e2e/live-work-group.spec.ts` checks, on the fake bridge's `TOOL_STREAM … NARRATED`, that a running chat shows one group over its narrated reads, that the opening line and the answer stay out, and that opening it shows each message.
