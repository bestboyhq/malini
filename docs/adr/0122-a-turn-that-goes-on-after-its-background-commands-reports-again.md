# 0122 - A turn that goes on after its background commands reports again

Status: accepted

## Context

ADR 0037 made a turn that ends while only background commands run read as finished, and `FinishedTurns` (`src/lib/chat/platform/finished-turns.ts`) logs **Turn finished** for it at once, so a dev server never holds up a lead or a queued prompt.
It then dropped that run's later `run.completed` and `run.failed`, although Claude Code wakes the agent when a finite command ends, and the agent goes on in the same run.
Deliveries (0109, 0110) and Shipping (0086) act only on **Turn finished**.
On Oct 29 a workstream's chat ended its turn over "Wait for the merge from main to land" and worked six more minutes; the lead chat that started it never got that turn's report, its prompt waited 13 minutes until another send flushed it, and the turn's changes stayed uncommitted.
The one report the lead got said "finished a turn" with "Outcome: none", while that chat was still working.

## Decision

- `FinishedTurns.after` forgets that it announced a run once the agent works in it again (`resumesTurn`: an assistant message, thinking, a plan or a tool call), the signal the runtime already uses to drop the run's open turn reply, and the renderer to chime again (0037).
  The run's next end, over background commands again or by `run.completed` or `run.failed`, logs another **Turn finished** with its own `Outcome:` and `Needs:`.
  A run the agent never goes on in is announced once: the `background.updated` events after it, the completion of a run a prompt takes over, and the completion when its commands stop stay quiet.
- `ChatTurnFinishedPayload.backgroundCommands` (`src/contract/events.ts`) names the background commands an early end waits on, by their descriptions, and is `null` once the run itself ended.
- Deliveries words the early report from it, "is waiting on its background command “Wait for the merge from main to land”, and reports again if it continues" (`reportedTurnEnd` in `src/lib/chat/domain/deliveries.ts`), and `WorkstreamReport.backgroundCommands` carries it to the lead's brief and timeline, whose row reads **ended its turn · waits on** the command; the Explorer's **Turn finished** names it too.
- Every consumer takes the second **Turn finished** as one more ended turn: Deliveries hands the chat what waits for it and reports the turn, Shipping asks for the commit, and a job triggered `on chat:turn-finished` runs again; `where backgroundCommands is set` picks out early ends.

## Consequences

- A lead hears the real result of every turn its workstreams end, a prompt it sent meanwhile arrives once that turn ends, and the turn's changes are committed.
- A run can log several **Turn finished** events, so nothing may key on one per run; the lead timeline keys reports by their place in a prompt, since a run's early and late reports can arrive in one prompt.
- Announced runs stay in memory and are forgotten past 2 000 (the `ponytail:` in `finished-turns.ts`).
- When the early end already committed under the run, the later commit of that run takes the `Pull request:` title or the changed files as its message, as any second commit of one run does.
- Enforced by `src/lib/chat/platform/finished-turns.test.ts`, `deliveries.service.test.ts` ("reports a turn that waits on a background command, then the turn that goes on, and hands the chat what waited"), `src/lib/chat/domain/deliveries.test.ts` (`reportedTurnEnd`), `lead-brief.test.ts`, `src/lib/chat/presentation/lead-timeline.test.ts`, and `tests/e2e/lead-timeline.spec.ts` ("a lead hears a turn that ends over a background command, and again when it goes on, which delivers what waited and commits").
