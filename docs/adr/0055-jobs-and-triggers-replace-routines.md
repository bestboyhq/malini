# 0055 - Jobs and triggers replace routines

Status: accepted

## Context

0050 put a job's **When** on a routine of its own, and kept multi-step routines, extension steps and suggestions under a **Routines** section, so Malini had three words, jobs, automations and routines, for two ideas.
Brainstorming in a chat, the user asked whether opening a draft pull request was a job, a routine or an automation, and settled the model: "We only need jobs and triggers", events trigger jobs (resolving conflicts is a job), opening a draft is a job too, and jobs call each other.
They agreed that a job finishing should not call the next job itself but ask the job runner, fire and forget, and that **Ask me first** belongs to the runner rather than to a routine.
Routines also ran their steps by waiting on each job (0028), which kept a promise open per routine run, and gated runs lived in their own table beside the job runs they became.
The user's own database held no routines and no gated runs, only built-in jobs.

## Decision

- A job is the only automation.
  `JobDefinitionRecord` (`src/contract/jobs.ts`) carries `trigger: { when, mode } | null` and `thenJobId: string | null`, and no longer `output`.
  `when` is an event trigger, `on <channel> [where …]`, parsed by `parseAutomationTrigger`; `mode` is `off`, `ask` or `auto`, shown as Off, Ask me first and On its own.
- **Then** is the one job that runs after this one succeeds, in its workstream, with its result as context.
  The runner asks for it through `jobs.run` with `origin: 'then'` and `parentRunId`, and does not wait for it.
  Opening a draft or queuing a merge is a Then on the built-in **Open draft** or **Merge** job (0056).
- Every start goes through `jobs.run`, which only saves a run; `JobRunner` alone starts runs.
  **Ask me first** saves the run as `waiting`; the runner never starts, counts or recovers a waiting run, `jobs.confirm-run` queues it and `jobs.cancel-run` skips it.
- `jobs.run` refuses a run whose job already ran earlier in its `parentRunId` chain (kind `loop`, depth 32), and `jobs.save-definition` refuses a Then that closes a cycle.
  Event triggers on `jobs:run-changed` pass the event's run as the parent and skip a job already in that chain, which replaces 0028's `origin: 'routine'` guard; a refused loop is an expected failure (`JobError` `loop`), logged as a warning.
- `startJobTriggers` (`src/lib/jobs/platform/job-triggers.service.ts`) arms every job whose trigger is `ask` or `auto`, re-syncs on `jobs:definition-changed`, and asks for one run per matching event payload.
- Only a user job and the built-ins Update docs, Open draft and Merge (`isTriggerableJob`) take a trigger or a Then.
- Migration 57 rebuilds `job_definitions` and `job_runs` without cascading run history away: a job's oldest event routine becomes its trigger (draft, candidate, routine become off, ask, auto, and "when a new workstream is created" becomes `on repositories:workstream-created`), consecutive job steps become Then links, `output` draft and merge become Thens, pending gated runs become waiting runs, `routine_suggestions` becomes `job_suggestions`, and `routines`, `routine_gated_runs` and remembered `routines.save` approvals are dropped.
- Suggestions move to the jobs domain: `jobs:suggested`, `jobs.list-suggestions`, `jobs.accept-suggestion` and `jobs.dismiss-suggestion`, shown on the Jobs Overview.
- The `routines` domain, the Routines section, the `routines.*` commands, the `routines:*` events and the `routines_list` and `routines_save` agent tools are gone; `jobs_save` takes `when` and `then`, and a trigger an agent adds starts Off.
  A job runs without asking when it is built in, always allowed to run, has a trigger that is not Off, or is the Then of such a job; an agent edit to it is reviewed (0053).
- Extensions keep their own automations in `.malini/workspace.json`, run by the renderer's automation runtime, which no longer loads, gates or reloads database routines.

## Consequences

- The Jobs page shows one model: a job card's switch, its When and its Then are fields of the job, and held runs wait under Activity as runs.
- A job can follow another job only through Then or an event; a chain that needs a different next step per caller needs two jobs or an agent that calls `jobs_run`.
- A job has at most one trigger; a second event for the same work needs a second job.
- Extension commands and workflows are no longer steps Malini runs on events; they run only from `.malini/workspace.json` automations.
- 0028's event engine and 0050's job routine are superseded; the routine parts of 0029 and 0053 no longer apply.
- Enforced by `src/main/db/migrations.test.ts` (migration 57), `src/lib/jobs/platform/register.test.ts` and `job-triggers.service.test.ts` (Then, waiting runs, the loop guard, triggers), the bridge's `protocol.test.ts`, `tests/e2e/jobs-page.spec.ts` (When, mode, Then, a refused loop) and `tests/e2e/job-runs.spec.ts` (Then opens a draft, Run it and Skip, a trigger that never re-starts its chain, suggestions).
