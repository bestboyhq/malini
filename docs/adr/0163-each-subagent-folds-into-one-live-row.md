# 0163 - Each subagent folds into one live row

Status: accepted

## Context

The user asked whether Malini pushes subagents, since agents mostly used background tasks and rarely the Agent tool.
Malini's instructions never mentioned subagents, so Claude Code's own advice to avoid them for simple lookups won.
When an agent did use one, the bridge already tagged each of its tool calls with `parentToolCallId`, but the renderer dropped the tag: one research subagent in the user's own chat spread 68 tool calls through the transcript as flat rows, around a pointer line, "This agent's report was delivered".
A background agent also outlives a handoff (0009, 0047), so its later steps landed in the new run, apart from the row that started them.
The user wanted each subagent to be "a stable line with load there and those beautiful vertically swapping lines", like a thinking row.

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
  The row is a toggle button, as `BashToolCall` is, so the `group/expand` marks of the steps inside never read its open state; open, it shows the prompt, each step as a normal tool row, and the report as Markdown, and its open state persists in `expandedActivityGroups`.

## Consequences

- A chat with subagents reads as one line per agent, and the steps are one click away.
- A subagent's text and thinking are still dropped by the transcript; only its tool calls and its report show.
- Both projectors must agree on placement: `incremental-run-timeline.test.ts` ("folds every subagent step into its agent row, live and replayed, across a handoff") checks every prefix of a handed-off background agent against the canonical fold.
- Enforced also by `transcript.test.ts` ("nests subagent tool calls under the task that spawned them"), `instructions.test.ts`, and `tests/e2e/subagents.spec.ts` and `tests/e2e/background-agents.spec.ts` on the fake bridge's `SUBAGENTS` and `BACKGROUND_AGENT` directives.
