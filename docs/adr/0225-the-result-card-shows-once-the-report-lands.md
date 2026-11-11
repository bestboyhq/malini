# 0225 - The result card shows once the report lands

Status: accepted

## Context

The result card (`TurnReportCard.svelte`) showed only once `run.turnEnded` was true: on `run.completed`, or on the `background.updated` summary when only background commands remain (ADR 0037).
A run goes on after its reported message while a background agent works, while a Stop hook runs, or while it is paused on a limit (ADR 0100), so the user read the report as plain markdown for that whole time.
A run that failed or was stopped after its report never got a card at all.
While the reply streamed, its `Outcome:` and `Needs:` lines showed as raw text, then the card replaced them.
The user said: "we have run summary cards that by the way are not summarized until the run finishes, which is also not great."

## Decision

- `finalTurnReport` in `src/lib/chat/presentation/turn-result.ts` reads neither `run.turnEnded` nor `turn.answered` (amends 0222).
  The card belongs to the run's last complete assistant message with a report footer, as soon as it exists.
  `runTurns` and `foldsIntoLaterTurn` read `answerTurn(run)`, the answered reports plus that latest one.
  When the same run writes a newer reported message, the card moves to it: an older answered report folds into **Earlier turns** (0222), and an unanswered one shows as prose without its footer.
  The earlier-turns list and variant picks use `runTurns`, so the trail moves to the new card when it shows, not when the turn answers.
- `turnOver(run)` is `turnEnded`, or a `failed` or `cancelled` terminal.
  A `paused` run is not over, since Malini resumes it (ADR 0100).
- `ChatTimelineRow.svelte` passes `ended={turnOver(run)}` to the card, and opens its needs only when the turn is over.
- `turnStatus` in `src/lib/chat/domain/turn-report.ts` returns a third status, `unfinished`, while the turn is not over.
  The card shows it as a clock labelled **Still running** with a neutral rail, and its needs sit in the closed style under **Over to you after**.
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
- Enforced by `turn-report.test.ts` ("never shows a footer line while the reply streams, and only ever grows the text it shows", and the `unfinished` status case), `turn-result.test.ts` ("is only the last answer of a run that carries a report, whether or not its turn answered or the run ended", "moves to a newer report the same run writes, and ends the turn only once the run stops for good", "moves to the next report the same run writes, and folds the earlier answered one into it"), `render-projector.test.ts` ("shows each answered report at once while only background commands run, and folds the earlier one"), `tests/e2e/turn-report.spec.ts` ("the result card shows as soon as the report lands, and asks only once the run ends", "a run stopped after its report keeps the report as its result card") on the fake bridge's `REPORT_HELD` directive, and `tests/e2e/background-agents.spec.ts` ("a turn's report card shows at once while its background agent runs, then folds into the next report").
