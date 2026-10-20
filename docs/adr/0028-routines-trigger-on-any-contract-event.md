# 0028 - Routines trigger on any contract event

Status: accepted

## Context

Until now a routine fired only on two extension events, a new workstream and a resource becoming ready, and only inside the renderer's `WorkstreamExtensionAutomationRuntime` for the workstream that was open.
That design had no ADR; this one reverses part of it.
The product goal is that routines trigger on any platform event, so agents can automate around merges, job results, updates and every other event in `ContractEvents`.
Those events are emitted on the main process `EventBus`, often for a workstream nobody has open, so a renderer runtime cannot see them all.
Extension steps (`workflow`, `command`) need the open workstream's extension host, which only the renderer has.

## Decision

- `parseAutomationTrigger` in `src/contract/automation-trigger.ts` accepts `on <channel>`, optionally followed by `where <dotted.path> is <value>` or `where <dotted.path> is set`, more conditions joined by `and`.
  It returns `{ kind: 'event', channel, where, description }`; an unknown channel throws and names the channels of the same domain.
- `EVENT_CHANNELS` and `isEventChannel` in `src/contract/events.ts` list every channel at runtime, from a `Record<EventChannel, null>` that fails `pnpm check` when a channel is missing.
- The main process owns event routines: `startEventTriggers` in `src/lib/routines/platform/event-triggers.service.ts`, started by `registerRoutines`, keeps one `EventBus` subscription per channel used by a `candidate` or `routine`, and re-syncs on `routines:changed`.
- On a matching event it adds `repositoryId` from the payload's `workstreamId`, then runs each `{ job }` step in order through `jobs.run` with `origin: 'routine'`, the payload's `workstreamId` and `repositoryId`, and the event as `context`, waiting for each job to finish.
- A candidate records a gated run instead (`workstreamId` is `''` without one); confirming it through `routines.confirm-run` runs the steps with the stored payload.
- Event routines take only job steps: `routines.create-draft` and `routines.update` reject any other step.
- Loop guards: the engine ignores `jobs:run-changed` for runs with `origin: 'routine'`, ignores events it emits itself, and fires once per routine and event payload for the process lifetime.
- The renderer leaves event routines alone: `compileWorkstreamAutomation` gives them `event: null`, and the runtime neither holds nor rejects their gated runs.

## Consequences

- Any event in the contract can start agent work, for a workstream that is not open and while the window is closed.
- Event routines cannot run extension workflows or commands; that would need the main process to reach an extension host.
- The process-lifetime dedupe means an identical payload fires again after a restart; gated runs dedupe across restarts through their unique `run_key`.
- A new contract channel must be added to `EVENT_CHANNEL_INDEX`, which `pnpm check` enforces.
- `src/lib/routines/platform/event-triggers.service.test.ts` and `src/contract/automation-trigger.test.ts` cover the grammar, matching, the loop guard, the candidate gate and drafts.
