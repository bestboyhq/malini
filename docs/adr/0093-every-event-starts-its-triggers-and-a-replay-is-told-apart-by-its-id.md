# 0093 - Every event starts its triggers, and a replay is told apart by its id

Status: accepted

## Context

0085 decided that "an event whose digest already started a job (`job_run_events`) never starts that job again, even after a restart", to keep a replayed `jobs:run-finished` from starting its Then twice.
The digest was a SHA-256 of the canonical payload, stored in `event_log.digest` behind `idx_event_log_digest`, and `job-triggers.service.ts` also kept the last 5 000 digests in memory, with a `ponytail:` comment naming the event id as the upgrade path.
A digest names what an event says, not that it happened: `pull-requests:workstream-opened` carries only `{ workstreamId }`, `app:started` only `{ version }`, `repositories:changed` and `app:close-requested` nothing, and a second Draft all on the same chat and workstreams repeats the first.
A trigger on any of them started its job once and then not again for the week the log keeps the event, and 0092 wrote that down: "like every trigger, it starts once for clicks whose payloads are identical".
A sandbox run reproduced it: a job on Workstream opened, set to Ask me first and skipped once, never asked again when the workstream was opened a second time, while the log held both openings with one digest and only the first named a run.
Asked whether the guard should key on the event's id instead, the user said: "Oh yeah, every event should have its own ID."

## Decision

- **A replay is the same event.**
  `triggeredBefore(db, definitionId, eventId)` in `src/lib/jobs/platform/event-log.repository.ts` asks `job_run_events` whether a run of that job already names the event, through `idx_job_run_events_event`.
  The triggers, Thens, the Schedules rule and the Compatibility rule pass `event.id`.
  An event Malini does not log has no id and is never replayed, so `triggeredBefore` never counts it as started: the `logged: false` channels, and an event whose log write failed.
- **Every event counts.**
  A second event with the payload of an earlier one asks for the job again: while the first run still waits or is queued it folds into it as another ask, as 0085's folding says, and otherwise it starts a new run.
- **The digest is gone.**
  `eventDigest`, `DispatchedEvent.digest` and the in-memory set in `job-triggers.service.ts` are deleted, and migration 70 drops `idx_event_log_digest` and `event_log.digest`.

## Consequences

- A trigger on opening a workstream, a click, Malini starting or anything else whose payload repeats starts its job each time it happens.
- A replay at boot keeps its row and its id, so a Then, a scheduled time, a compatibility check and a trigger still start once per event across a restart.
- An emitter that reports one fact twice now starts its triggers twice, so emitters keep reporting on change only, as `#save` in `shipping.service.ts` does with `sameRecord`, `announceUpdate` does by storing the version before it emits `app:updated`, and the scheduler does with one Time reached per due time.
- Each unlogged event counts on its own, so a trigger on `jobs:run-changed` hears every change a run goes through; the docs already point triggers at `jobs:run-finished`.
- Logging an event no longer hashes its payload.
- This changes 0085's digest line and 0092's consequence about identical clicks; the rest of both stands.
- Enforced by `src/lib/jobs/platform/job-triggers.service.test.ts` (a workstream opened again after its run was skipped asks again, the openings handed back after a restart start nothing, and two matching events count as two asks), `event-log.service.test.ts` (a Then starts once across a restart), `job-schedules.service.test.ts` (a Time reached handed back after a restart starts nothing), `register.test.ts` (Check compatibility once per update across a restart) and `src/main/db/migrations.test.ts` (no digest index).
