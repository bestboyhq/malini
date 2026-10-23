# 0050 - A job's trigger is its own routine

Status: superseded by 0055

## Context

The Jobs page split jobs and routines into two tabs, and the user found it horrible to work with.
The redesign the user approved gives every job a **When** and a run mode, **Off**, **Ask me first** or **On its own**, on one Automations page.
It shipped in #27 as a prototype under `/jobs/lab`, with triggers and modes held in memory, while `/jobs` kept the old page.
Routines already carry a `when` and a `draft`, `candidate` or `routine` status, and the main process runs their job steps on any event (0028).

## Decision

- A job's trigger is the oldest routine whose steps are exactly `[{ job: <id> }]`, read by `ownRoutineOf` and `jobTriggerOf` in `src/lib/routines/domain/job-trigger.ts`; a manual `when` counts as no trigger.
- Off, Ask me first and On its own are `draft`, `candidate` and `routine`.
  `setJobTriggerCommand` creates, updates, promotes or demotes that routine one status at a time, and deletes it when the job goes back to "When you run it"; `createTriggeredJobCommand` saves a drafted job, then sets its trigger.
- Nothing new is stored and no command changes; `JobTrigger` in `src/contract/routines.ts` is the shape both domains pass.
- The page lives in `src/lib/jobs/presentation/automations` at `/jobs`, `/jobs/activity`, `/jobs/routines`, `/jobs/recipes` and `/jobs/:jobId`.
  Jobs presentation may not import routines application code, so `app/presentation/pages/JobsPage.svelte` and `JobsSidebar.svelte` read the routines queries and pass triggers, their state and the held-run count as props.
- Built-in jobs Malini starts on its own (0011) show their fixed trigger and no switch; Update docs takes a trigger like the user's own jobs.
- The main process deletes a job's own routines when the job is deleted (`deleteJobOwnRoutines` on `jobs:definition-changed`).
- Routines with several steps, extension steps and suggestions stay under **Routines** on the same page.

## Consequences

- One model drives both views: a job card's switch and the Routines list show and change the same routine, and held runs wait under Activity and on the routine.
- Moving a job from draft to routine takes two `routines.promote` calls, so its card shows the switch busy until both land.
- A second single-job routine for the same job shows only under Routines.
- Enforced by `src/lib/routines/domain/job-trigger.test.ts`, the delete case in `src/lib/routines/platform/register.test.ts`, and `tests/e2e/jobs-page.spec.ts`, which drives a drafted job through every mode, a custom event, back to manual, and a delete.
