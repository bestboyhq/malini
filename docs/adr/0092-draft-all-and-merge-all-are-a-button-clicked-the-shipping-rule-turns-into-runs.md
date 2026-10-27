# 0092 - Draft all and Merge all are a Button clicked the Shipping rule turns into runs

Status: accepted

## Context

0089 had **Draft all** and **Merge all** call `jobs.run` from the renderer (`runShippingJobCommand`), once per started workstream, with origin `manual` and the chat's session as `chatSessionId`.
The single Draft and Merge already log `pull-requests:button-clicked`, which the Shipping rule hears (0086), and `eda.mdc` says that whatever starts work is a reconciler rule that hears logged events.
Reading 0091's question, the user said: "I was sure that every single event that happens within the platform gets reconciled", and Draft all and Merge all were one of the two starts that skipped the reconciler: no event was logged, and the Explorer drew their runs straight from **You** to **Jobs**.
The user asked: "Make Draft all and Merge all log Button clicked so Shipping starts them".
Every check on the origin `merge-queue` assumed Shipping's runs were its fixes, which Shipping follows up itself: the model step skipped them, Shipping read its last fix from the latest of them, and the chain count left them out.

## Decision

- **One click, one event.**
  `ShipAllButton` (`draft-all`, `merge-all`) joins `$contract/pull-requests`, and `pull-requests.button-clicked` takes `ShipAllClicked`: the chat's `workstreamId`, the `button`, the `workstreamIds` to ship and the `chatSessionId` to report to.
  `ship.register.ts` validates it and emits it as one `pull-requests:button-clicked` on the chat's workstream, without touching any shipping state.
  `shipAllCommand` (`src/lib/pull-requests/application/commands/ship-all.command.ts`) sends it, `startedShipAction` takes the button and the clicked workstream, and `runShippingJobCommand` is gone.
- **The Shipping rule starts the runs.**
  On such a click, `Shipping` runs Open draft or Merge in each named workstream with origin `merge-queue`, the click's `chatSessionId` and the click as `causeEventId`; a click on one workstream's bar still wakes that workstream.
  The runs are 0089's runs: each waits for its workstream's agent, waits in the chat's composer tray, and reports to the chat.
- **`merge-queue` is every run Shipping starts.**
  Where a check meant Shipping's fixes, it now says so.
  The model step leaves Shipping only its fix jobs (`isShippingJobBuiltin`: Fix checks, Update from main, Resolve conflicts, Address review), so an Open draft or Merge it ran for a chat reaches that chat, or asks you when it fails.
  Shipping reads its last fix from `latestShippingJobRun` in `jobs.platform.ts`.
  `countChainJobRuns` counts Shipping's runs apart from everyone else's: the chain budget is as before, and "It ran N times in this chain" counts a Shipping run's own repeats.
- **The Explorer names the click.**
  Button clicked reads "Button clicked: Draft all" or "Merge all", and the runs list under Shipping as "Shipping heard button clicked".

## Consequences

- Every start in Malini but your own prompts and the jobs you run goes through a logged event and a reconciler rule.
- A click Malini quits before handling is replayed at boot and starts its runs then.
- Draft all and Merge all runs stay out of the chain budget, as every Shipping run does; 0089's runs each started a new chain, so no click waits on it either way.
- Their runs carry `run.origin` `merge-queue` instead of `manual`, so a trigger that filters on `manual` no longer sees them.
- A trigger can start on `pull-requests:button-clicked where button is merge-all`; like every trigger, it starts once for clicks whose payloads are identical.
- This changes 0089's `runShippingJobCommand` line and 0086's list of what Button clicked is; the rest of both stands.
- Enforced by `src/lib/pull-requests/platform/shipping.service.test.ts` (the click logged on the chat and one Merge per named workstream with its chat, origin and cause, a click naming no workstream refused, conflicts an update left resolved while a Merge waits for a chat), `src/lib/jobs/platform/reconciler.service.test.ts` (a failed Merge Shipping ran for a chat reaches it with its repeats counted, Shipping's own Fix checks does not), `register.test.ts` (Shipping outside the budget), and `tests/e2e/merge-queue.spec.ts`: "Draft all and Merge all on a chat ship the workstreams it started once their agents finish" also fails when a run is not `merge-queue`, when the Explorer does not list both clicks under Button clicked, or when either run is missing under Shipping as "Shipping heard button clicked".
