# 0222 - A report card shows each answered turn at once

Status: accepted

## Context

The report card showed only once its run's turn had ended: `turn.ended` (0221) or the run's end set `turnEnded`, and the card took the run's last report.
A background agent keeps the turn open (0037, 0221), so a turn that launched one and answered showed its report as plain text with no card until the agent ended.
A run can hold several turns: the agent goes on once its background agent ends, and writes a new report.
The card then took the first report it saw ended and marked an out-of-date outcome **Done**.
The user asked why the summary card cannot render while background work runs, and picked variant A, **Card at once**, of three prototypes.

## Decision

- The bridge protocol (v55, `packages/agent-bridge/protocol/bridge-protocol.json`) adds `turn.answered`, with only its `runId`.
  `ClaudeTranscript.recordTurnResult` emits it for every result Claude Code gives the run, after the reply that result releases.
  It is not a lifecycle kind: the session status does not move on it.
- Both render projectors (`render-state.ts`, `render-projector.ts`) keep `answeredReports` on each `RunGroup`, the keys of the reports that answered a turn, in order.
  `answerTurn` in `turn-result.ts` appends the run's last report on `turn.answered`, and on `run.completed` for transcripts recorded before v55.
- The card shows the last answered report of a run, whatever the run's status, and the run's status line stays under it while the run is open.
- An earlier answered report of the same run leaves the timeline (`linearizeRunTimeline`) and sits in that card's **Earlier turns**; the latest card also lists the turns of earlier runs, as before.
- **Earlier turns** and variant picks key on the report's item key, not the run id, since one run can now hold several reports.

## Consequences

- A report reads as a result the moment its turn answers, while a background agent or subagent still runs.
- A run with several reports shows one card, its latest, and no report shows twice in one run.
- A follow-up turn with no report, such as a note after a dev server stops, leaves the card on the last report.
- Transcripts from before v55 show the card only at the run's end, as they did.
- Enforced by `turn-result.test.ts`, the parity test in `render-projector.test.ts`, the turn tests in `packages/agent-bridge/src/claude/session.test.ts`, and `tests/e2e/background-agents.spec.ts`, whose fake bridge emits `turn.answered`.
