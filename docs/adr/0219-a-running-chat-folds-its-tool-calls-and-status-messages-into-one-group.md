# 0219 - A running chat folds its tool calls and status messages into one group

Status: accepted

## Context

An agent works in bursts: a few tool calls, a short status message, a few more tool calls.
`groupRunTimeline` in `activity-group.ts` ended its group at every assistant message, so each burst became its own "Explored 3 files" line with the status message between them.
The latest turn also skipped groups: `groupedTimelineItems` returned the flat timeline for the last run, and for every run that had once been the last, so a chat that was working showed one row per tool call.
The user asked: "we should collapse tool calls into groups. When you have a chat that is running it has tool calls, some stuff is happening, then it sends some quick status update message and then it calls another set of tools. I think we should collapse those tool call groups together."
The fold over an older turn (0174) then held those groups, so its steps sat two levels deep, and the user asked: "We should have just a list of tool calls and what was happening. That is just grouped together and that's it."
A run past 200 events also drew only its newest 200 and a **Show N older events** button, which 0174 moved inside the fold, and the user said of it: "we shouldnt have this anymore".

## Decision

- `groupRunTimeline` keeps one activity group open across assistant messages: a message that sits between two tool calls, commands or file edits goes inside the group, in order.
- A message before the first tool call or after the last one stays a row of its own, so the opening line and the answer stay in view.
- A thought between two tool calls joins the group too, as a status message does: a real turn alternates thoughts and calls, and a group that each thought ended split one turn into some twenty lines.
- A thought before the first tool call or after the last one stays a row of its own, so a live thought streams in view.
- Compactions, plans, approvals, questions, handoffs and subagents still end a group, and a message or thought next to one of them stays outside.
- `groupedTimelineItems` groups every run, the running one included: `shownLinear` and the `isLastRun` argument are gone.
- The group's line still counts only its tool calls, commands and files.
- While the run is open and no other row follows the group but messages and thoughts, its line takes the present verb with a shimmer, such as "Exploring", and shows the newest status message or thought beside it, as a thought's line shows its last step.
- Opened, `ChatActivityGroup.svelte` draws each status message as a compact row with a chat icon in the tool rows' icon column, in secondary text, never as a full reply.
- The activity group and the fold over an older turn open with `ExpandMark`, like the Thought row, tool calls and subagents, not a chevron: at rest the line shows the icon of its main kind of work from `leadActionKind`, a plus on hover and a minus while open, and the kind icons after the count leave that one out.
- `withPendingRows` counts the rows inside a group as drawn, so a streaming tool call never shows twice.
- `foldRunWork` unpacks the activity groups and subagent groups of an older turn, so its fold lists every tool call, command, thought, subagent and status message directly, one level deep; `ActivityMessageRow.svelte` draws a status message the same way in both folds.
- The 200-event window over each run, `windowRunTimeline`, and its **Show older events** button are gone: groups and folds keep a long run to a few lines, so every run draws all of its steps.
- `StepRows.svelte` draws the rows of an opened group or fold, each a `TranscriptRow`: the rows that fill two screens mount at once and the rest mount as they come near, so opening a thousand steps stays cheap.

## Consequences

- A running chat reads as one line per burst of work, and a status message folds into it as soon as the next tool call starts.
- The newest status message stays on the group's line while the run works, and every earlier one is one click away.
- A tool call that runs now sits behind its group's line, which turns to "Exploring" or "Running" while one is unfinished and keeps failures visible below it.
- `activity-group.test.ts` checks that messages between tool calls stay in one group, that a leading or trailing message stays out, that every other row still breaks a group, and that a fold holds no group; `transcript-round-fold.spec.ts` checks that an opened fold shows its steps with no group inside.
- An older turn opens to one list of its steps, with no group inside it.
- A run of any length shows all of its steps, with no button to load older ones.
- `tests/e2e/live-work-group.spec.ts` checks, on the fake bridge's `TOOL_STREAM … NARRATED`, that a running chat shows one group over its narrated reads, that the opening line and the answer stay out, and that opening it shows each message.
