# 0223 - The result card shows once the report lands

Status: accepted

## Context

The result card (`TurnReportCard.svelte`) showed only once `run.turnEnded` was true: on `run.completed`, or on the `background.updated` summary when only background commands remain (ADR 0037).
A run goes on after its reported message while a background agent works, while a Stop hook runs, or while it is paused on a limit (ADR 0100), so the user read the report as plain markdown for that whole time.
A run that failed or was stopped after its report never got a card at all.
While the reply streamed, its `Outcome:` and `Needs:` lines showed as raw text, then the card replaced them.
The user said: "we have run summary cards that by the way are not summarized until the run finishes, which is also not great."

## Decision

- `finalTurnReport` and `runTurn` in `src/lib/chat/presentation/turn-result.ts` no longer read `run.turnEnded`.
  The card belongs to the run's last complete assistant message with a report footer, as soon as it exists.
  When the same run writes a newer reported message, the card moves to it and the older one shows as prose without its footer, as before.
  The earlier-turns list and variant picks use `runTurn`, so the trail moves to the new card when it shows, not when the run ends.
- `turnOver(run)` is `turnEnded`, or a `failed` or `cancelled` terminal.
  A `paused` run is not over, since Malini resumes it (ADR 0100).
- `ChatTimelineRow.svelte` passes `ended={turnOver(run)}` to the card, and opens its needs only when the turn is over.
- `turnStatus` in `src/lib/chat/domain/turn-report.ts` returns a third status, `unfinished`, while the turn is not over.
  The card shows it as a clock labelled **Not over yet** with a neutral rail, and its needs sit in the closed style under **Your turn next**.
  **Done**, **Waiting on you**, **Your turn** and the variant pick form appear only once the turn is over.
- A run that fails or is stopped after its report keeps the card, because the agent wrote that report and it is still what the agent claims and asks.
  The card has no failure state, and adds none: the run's terminal banner under the card (**Run cancelled**, or the failure and its error) says how the run ended.
  Its needs open as for a completed run, since the turn is over and the next move is the user's.
- `withoutStreamingFooter` in `turn-report.ts` drops footer lines from the streaming text in `TranscriptRun.svelte`.
  It reuses `reportFooter`, the parser behind `withoutReportFooter`, on the complete lines, and drops a trailing partial line that is still a prefix of a footer label (`Out`, `- **Nee`).
  It cuts the text at a line start and never trims it, so the shown text only grows and `BufferedStreamingMarkdown` never restarts its playback.
  A live block with nothing left to show renders nothing.
- Only the card changes.
  `turnEnded` still drives the sidebar, the hover card, notifications, chimes, the **Implement** plan button and every **Done** state outside the card.

## Consequences

- The card shows the moment the report lands, honest that the run still goes, and asks only once the turn is over.
- With **Plain replies** on (ADR 0178), the bridge holds a reply until its check passes, so the card still waits for the check; the streamed preview shows without its footer meanwhile.
- A footer written in an odd order, such as `Commit:` before `Outcome:`, shows its earlier lines while they stream, then drops them, which restarts that block's playback.
- Enforced by `turn-report.test.ts` ("never shows a footer line while the reply streams, and only ever grows the text it shows", and the `unfinished` status case), `turn-result.test.ts` ("is only the last answer of a run that carries a report, whether or not the run has ended", "moves to a newer report the same run writes, and ends the turn only once the run stops for good"), `render-projector.test.ts` ("ends the turn when the agent replies while only background commands run, until it works again"), `tests/e2e/turn-report.spec.ts` ("the result card shows as soon as the report lands, and asks only once the run ends", "a run stopped after its report keeps the report as its result card") on the fake bridge's `REPORT_HELD` directive, and `tests/e2e/background-agents.spec.ts` ("a background agent shows as running past the turn, then shows its result").
