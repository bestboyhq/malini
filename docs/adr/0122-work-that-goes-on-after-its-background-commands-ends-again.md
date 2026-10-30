# 0122 - Work that goes on after its background commands ends again

Status: accepted

## Context

ADR 0037 made a turn that ends while only background commands run read as finished, so a dev server never holds anything up: `FinishedTurns` (`src/lib/chat/platform/finished-turns.ts`) logs **Turn finished** for it at once, and the job runner finishes a job whose turn ends that way.
Both then dropped what came after, although Claude Code wakes the agent when a finite command ends, and the agent goes on in the same run.
Deliveries (0109, 0110), Shipping (0086) and Thens act only on **Turn finished** and **Job finished**.
On Oct 29 a workstream's chat ended its turn over "Wait for the merge from main to land" and worked six more minutes; the lead chat that started it never got that turn's report, its prompt waited 13 minutes until another send flushed it, and the turn's changes stayed uncommitted.
The one report the lead got said "finished a turn" with "Outcome: none", while that chat was still working.
Jobs had the same gap: in the sandbox app, "Warm-up note" ended its turn over "Wait for the warm-up" and kept its early summary as its result, its Then ran during the wait, before the job's own edit, and that edit stayed uncommitted.

## Decision

Chat turns:

- `FinishedTurns.after` forgets that it announced a run once the agent works in it again (`resumesTurn`: an assistant message, thinking, a plan or a tool call), the signal the runtime already uses to drop the run's open turn reply, and the renderer to chime again (0037).
  The run's next end, over background commands again or by `run.completed` or `run.failed`, logs another **Turn finished** with its own `Outcome:` and `Needs:`.
  A run the agent never goes on in is announced once: the `background.updated` events after it, the completion of a run a prompt takes over, and the completion when its commands stop stay quiet.
- `ChatTurnFinishedPayload.backgroundCommands` (`src/contract/events.ts`) names the background commands an early end waits on, by their descriptions, and is `null` once the run itself ended.
- Deliveries words the early report from it, "is waiting on its background command “Wait for the merge from main to land”, and reports again if it continues" (`reportedTurnEnd` in `src/lib/chat/domain/deliveries.ts`), and `WorkstreamReport.backgroundCommands` carries it to the lead's brief and timeline, whose row reads **ended its turn · waits on** the command; the Explorer's **Turn finished** names it too.
- Every consumer takes the second **Turn finished** as one more ended turn: Deliveries hands the chat what waits for it and reports the turn, Shipping asks for the commit, and a job triggered `on chat:turn-finished` runs again; `where backgroundCommands is set` picks out early ends.

Jobs:

- `JobRunner` (`src/lib/jobs/platform/job-runner.service.ts`) still finishes a job at once when its turn ends over background commands, and remembers that agent run (`#waitingRuns`) until the agent goes on or the run ends.
  When the agent goes on, the job run is running again and finishes at the run's next end with that end's status and summary, so **Job finished** fires again and Shipping asks for the commit.
- A commit takes the `Commit:` line of the latest run, a chat's or a job's, that ended since (`workstreamShipContext` reads job sessions for `commitLine`, while `runSummaries` and the pull request title stay the user's), and a settled **Fix checks** or **Address review** takes its own line before its fixed fallback (`settledJob` in `ship-moves.ts`).
  A run's line names one commit (`runLineCommitted` in `repositories/platform/register.ts`): a later end with a new line commits under it, the same line again falls back, and a merge keeps git's message and uses up the line of a run it is the first commit for.
- A job's Then starts at most once per job run (`childJobRun` in `job-runs.repository.ts`).
  A queued Then, or any run the job started, waits while the job's agent may still go on (`#awaitsItsJob`): the early end left no report (`hasTurnReport`), and the run has neither gone on nor ended.
  When the job ends again, a Then still waiting takes the last result as its context, or is cancelled when the job did not succeed.
- An early end with the job's report is its result: its Then starts at once, so a job that reports and leaves a dev server running never waits for it.

## Consequences

- A lead hears the real result of every turn its workstreams end, a prompt it sent meanwhile arrives once that turn ends, and the turn's changes are committed.
- A job's result is the one its last end gave; Jobs shows a job that goes on as running again, and its edits after the wait are committed.
- A run can log several **Turn finished** or **Job finished** events, so nothing may key on one per run; the lead timeline keys reports by their place in a prompt, since a run's early and late reports can arrive in one prompt, and Thens key on the job run, not the event.
- At an early end Malini cannot tell a command that will end and wake the agent from one that stays up, so it trusts the agent's report: a job that ends over a dev server without its report holds its Then until the server stops or the agent goes on.
- A Then that started after a reported early end does not run again when its job goes on; it acted on what the job reported, and the job's later edits are committed after it.
- A waiting Then holds only itself: other jobs queued in its workstream still start, as they would during any wait on background commands.
- Announced runs and waiting job runs stay in memory: announced runs are forgotten past 2 000 (the `ponytail:` in `finished-turns.ts`), and waiting job runs after a restart, which background commands do not survive either.
- Which line a run's commit used is read back from git, the subject and parents of its recorded commit in `workstream_commit_runs`, so no column records it; a commit git can no longer show counts as having used every line.
- Enforced by `src/lib/chat/platform/finished-turns.test.ts`, `deliveries.service.test.ts` ("reports a turn that waits on a background command, then the turn that goes on, and hands the chat what waited"), `src/lib/chat/domain/deliveries.test.ts` (`reportedTurnEnd`), `lead-brief.test.ts`, `src/lib/chat/presentation/lead-timeline.test.ts`, `src/lib/jobs/platform/register.test.ts` ("a job whose turn ends over background commands"), `tests/e2e/lead-timeline.spec.ts` ("a lead hears a turn that ends over a background command, and again when it goes on, which delivers what waited and commits"), and `src/lib/chat/platform/ship-context.repository.test.ts`, `src/lib/shared/repositories/domain/pull-request-metadata.test.ts`, `src/lib/pull-requests/platform/ship-rule.test.ts` (a job's line, a settled Fix checks job's line, a merge's message), `src/lib/shared/repositories/platform/workstreams.test.ts` ("commits a run again under the new line of its later end, never one line twice, and a merge uses up a line"), and `tests/e2e/job-runs.spec.ts` ("a job whose agent goes on after its background command runs again, holds its Then until it ends, and its edits commit under its own Commit line").
