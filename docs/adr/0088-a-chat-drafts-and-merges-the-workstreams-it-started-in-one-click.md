# 0088 - A chat drafts and merges the workstreams it started in one click

Status: accepted

## Context

A lead's top bar counts its workstreams ("4 of 4 merged") with no Draft or Merge (0070), so shipping what a lead delegated meant opening each workstream and clicking Merge there, or asking the lead's agent to call `jobs_run` once per workstream (0067).
The user asked: "i wanna have draft/merge btns on a chat level (so i can delegate eg. merging its workstreams with one click)".
The Open draft and Merge jobs already do the work: the job runner keeps a run queued until the workstream's agent ends its turn, and a run with `chatSessionId` waits in that chat's composer tray (0068) and reports to it through the reconciler (0085).
This changes 0070's "with no Draft or Merge"; the rest of 0070 stands.

## Decision

- `LeadTopBarStatus.svelte` publishes **Draft all** as the secondary action and **Merge all** as the primary one, icon-only with those tooltips in the docked top bar, named "Open draft pull requests in N workstreams" and "Merge N workstreams".
  The hover card of any sidebar row that started workstreams shows the same two buttons beside its count, so a parent ships its work without opening it.
  Both build them with `startedShipAction` in `src/lib/app/presentation/started-ship-action.ts`.
- `shipTargets` in `src/lib/app/domain/lead-progress.ts` picks the workstreams: open ones the lead started that have changes, a pull request or an agent at work, and no unfinished Open draft or Merge run.
  **Draft all** takes those without a pull request (`none` or `unknown`), **Merge all** those not queued, needing you or merged.
  `leadProgressQuery.shipTargets` feeds it from pull request badges, change totals (`files`), the progress dot and `shippingJobRunsQuery`.
- `runShippingJobCommand` in the jobs domain calls `jobs.run` with the built-in job in each workstream, `origin: 'manual'` and the parent's chat session as `chatSessionId`, as `jobs_run` from that chat does: the session on screen from the top bar, and the parent's most recent chat from the hover card.
  `jobActionsStore` keys the call by the job's id, so a second click while the first is in flight does nothing, and a run that cannot start shows a toast about its workstream.
- No new command, event or main-process code: the Merge job calls `pull-requests.queue-merge` and Open draft `pull-requests.open-draft`, the same as each workstream's top bar.

## Consequences

- One click on a lead queues Merge in every started workstream, including ones whose agent still works; each merges after that agent's turn, and the lead's tray lists the runs as **Merge · Job in …**.
- A run whose workstream ends with nothing to ship fails there, and the reconciler tells the lead's chat, as a failed `jobs_run` does.
- The buttons hide a workstream once its run is queued, since `jobs.run` does not fold runs that carry a `chatSessionId`; a click elsewhere that queues a duplicate still only finds the merge already queued.
- Enforced by `lead-progress.test.ts` (which workstreams each button takes) and `tests/e2e/merge-queue.spec.ts`: "Draft all and Merge all on a chat ship the workstreams it started once their agents finish" holds the started workstream's turn, clicks **Draft all** in the top bar and **Merge all** in the hover card, and fails when a run is not in the lead's tray, starts before the turn ends, is not attributed to the lead's chat, or when the workstream does not merge and the count does not read "1 of 1 merged".
