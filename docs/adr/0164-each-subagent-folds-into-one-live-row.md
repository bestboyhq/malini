# 0164 - Each subagent folds into one live row

Status: accepted

## Context

The user asked whether Malini pushes subagents, since agents mostly used background tasks and rarely the Agent tool.
Malini's instructions never mentioned subagents, so Claude Code's own advice to avoid them for simple lookups won.
When an agent did use one, the bridge already tagged each of its tool calls with `parentToolCallId`, but the renderer dropped the tag: one research subagent in the user's own chat spread 68 tool calls through the transcript as flat rows, around a pointer line, "This agent's report was delivered".
A background agent also outlives a handoff (0009, 0047), so its later steps landed in the new run, apart from the row that started them.
The user wanted each subagent to be "a stable line with load there and those beautiful vertically swapping lines", like a thinking row.
Claude Code starts the Agent tool in the background by default, so each subagent also showed in the background tray above the composer, once as its row and once as a task.
The row's swapped label also flipped in whole, where the thinking row's line unfolds word by word.
Several subagents started together still read as unrelated rows, so the user asked for them slightly indented under one line they fold into once they finish.

## Decision

- **The instructions ask for it.**
  `maliniInstructions` in `packages/agent-bridge/src/claude/instructions.ts` has a `Subagents:` line: run independent parts as parallel subagents with the Agent tool, several calls in one message, and keep the thread for the plan, the review and the synthesis; a quick lookup or a single edit stays in the thread, and another repository or branch is a workstream.
- **Every child event carries its parent.**
  The transcript sets `parentToolCallId` on `command.completed` and `file.changed` as well as on `tool.started`, `tool.completed` and `tool.failed`, and `protocol.ts` parses it; the field is optional, so the protocol version stays.
- **A subagent's steps stay in the run that started it.**
  `foldEnvelopes` and `IncrementalRenderProjector` place a tool, command or file event in the run that owns its parent's open tool.
  At a handoff they carry every open background agent and the open steps under it to the new run's lookup, instead of discarding them, so a completion that arrives in the new run replaces the row in the old one.
  `outlivesHandoff` in `render-state.ts` decides what carries.
- **The timeline folds them.**
  `foldSubagents` in `run-timeline.ts`, and `IncrementalRunTimelineProjector` live, turn each Agent tool into a `subagent` item holding its steps in order and its report, which is the `message` of its `SubagentHandback` step; a child whose parent is not in the run stays a flat row.
- **One line, live.**
  `SubagentRow.svelte` draws the row: a busy icon, the orbit wave for a background agent, then the description shimmering while it runs, a `ToolLabel` ticker that swaps to the latest step's label, and the step count and duration.
  Once finished, the ticker shows the report's first line, and a failure shows its reason.
  While the Agent tool's input still streams, the row waits for the `description` in the partial JSON, so it never reads "Agent" before its task.
  Each swapped label unfolds word by word through `UnfoldText.svelte`, the reveal the thinking row's ticker uses too.
  The row is a toggle button, as `BashToolCall` is, so the `group/expand` marks of the steps inside never read its open state; open, it shows the prompt, each step as a normal tool row, and the report as Markdown, and its open state persists in `expandedActivityGroups`.

- **The row is the agent's only place.**
  `trayWork` in `background-work.ts` leaves out of the tray every agent task whose `toolCallId` has a row; the tray keeps background commands and other tasks, and the status line still counts the agents.
  A running row shows its elapsed time, ticking each second, and a stop button for the task `agentTaskOf` finds, which sends `stop_task`.
  A task the user stopped ends the row as completed with "Stopped. No hard feelings", not as failed: the transcript turns a `stopped` task notification without a `reason` into `tool.completed`.
- **Parallel subagents sit under one live line.**
  `groupSubagents` in `activity-group.ts` turns two or more subagents in a row into a `subagent-group`, on the live run as on older ones, and `withPendingRows` lets an agent whose input still streams join it.
  `SubagentGroup.svelte` draws that line like a subagent row: the busy icon, "3 subagents" shimmering, a ticker that counts "2 of 3 back", and the elapsed time; the agents sit under it, indented to its title, with no rail.
  `ExpandMark` keeps its icon while such a line is open, so the busy icon shows the whole run.
  Once all are back, the line folds 700 ms later, keeps "3 of 3 back" with the summed steps and the time from the first start to the last end, and a click opens it again; a toggle of the user's own wins and persists in `expandedActivityGroups`.
  A lone subagent stays its own row.
  Each row keeps the stop button's slot after its task ends, so the counts and times of a group line up.

## Consequences

- A chat with subagents reads as one line per agent, and the steps are one click away.
- A subagent's text and thinking are still dropped by the transcript; only its tool calls and its report show.
- Both projectors must agree on placement: `incremental-run-timeline.test.ts` ("folds every subagent step into its agent row, live and replayed, across a handoff") checks every prefix of a handed-off background agent against the canonical fold.
- Two agents a few seconds apart briefly read as one row before the second joins it under the line.
- Enforced also by `transcript.test.ts` ("nests subagent tool calls under the task that spawned them", "ends a background agent the user stopped as stopped, not as failed"), `background-work.test.ts` (`trayWork`), `activity-group.test.ts` ("groupRunTimeline subagents"), `subagent-row-model.test.ts`, `instructions.test.ts`, and `tests/e2e/subagents.spec.ts` and `tests/e2e/background-agents.spec.ts` on the fake bridge's `SUBAGENTS` and `BACKGROUND_AGENT` directives.
