# 0072 - Jobs run on a schedule, in a place of their own

Status: accepted

## Context

A job's When was only an event trigger (0055), so nothing in Malini ran daily; the user asked for "something that will be running, for example, once a day", "just a different job trigger just on schedule rather than event-based".
A schedule names no workstream the way an event does, and the user set its scope: "whole GitHub account or one of the organizations, or repository", the Home and organization levels of 0070's leads plus a repository.
An agent waiting to run a daily round in a repository listed what it needs: catch up once after sleep, never two runs at once, fresh code without a new workstream every day, no run sitting for hours on an approval nobody saw, and a notification when it fails or posts.
Malini is a desktop app with no backend (0001), so a schedule can only run while the app does; on macOS it keeps running with its window closed.

## Decision

- A When can be a schedule: `every <day | weekday | monday … sunday> at <HH:MM> [in <owner> | in <owner>/<repository>]`, parsed by `parseAutomationTrigger` into `kind: 'schedule'` with its cadence, time and place (`src/contract/automation-trigger.ts`); without `in`, it runs at Home.
  `jobs.save-definition` stores it as `scheduleWhen` writes it, with the repository or owner in the casing Malini's catalog has, and refuses a place no repository in Malini matches, and a schedule on Update from main, Open draft and Merge.
- `startJobSchedules` (`src/lib/jobs/platform/job-schedules.service.ts`) starts with the job runner and checks every 30 seconds by the Mac's local clock (`latestScheduleSlot`, `src/lib/jobs/domain/schedule.ts`).
  A job is due when its latest time is after its last change, its last scheduled run and the last time it tried, so missed times coalesce into one run at launch or wake, and a time before the schedule was set never runs.
  A due time is skipped while any run of the job is waiting, queued, running or needs you.
- A scheduled run is `jobs.run` with `origin: 'schedule'`, kept by migration 64, which rebuilds `job_runs` with that origin and a `scope` column (`home` or `owner:<owner>`).
  It runs in the job's own place: the workstream of its last scheduled run while that is still open and in the same place, or else a new lead chat (`repositories.create-lead { scope, name }`) or a new workstream of the repository, named after the job.
- Before a scheduled run in a repository workstream it already used, the runner merges the base branch into it (`JobRunner.#freshen`); when it cannot, because of uncommitted changes, an operation in progress or conflicts, the run's prompt says why.
- The main process notifies for scheduled runs, so a notification arrives with the window closed: when a run waits for your yes, needs you, fails or finishes, and a click opens its chat.
  A run that needs an approval still waits for it.
- The When picker gains **On a schedule** (day and time), and **Runs in** picks the place for a scheduled job; agents learn the grammar from `jobs_save` and the Automation instruction.

## Consequences

- Daily and weekly routines need no cron, launchd or cloud; they run only while Malini runs, a little late after sleep, and once however many times they missed.
- A scheduled job leaves one chat or workstream in the sidebar, not one a day, and its job sessions stay out of the tab bar as every job session does; archiving that place makes the next run start a new one.
- A schedule fires by the Mac's clock and time zone, so it follows the user when they travel; there is no hourly or cron syntax until someone needs it.
- An approval still blocks a scheduled run until someone answers, now with a notification; always allowing the command is how a routine stops asking.
- Enforced by `automation-trigger.test.ts`, `schedule.test.ts`, `job-schedules.service.test.ts` (due times, catch-up, overlap, reuse with a merge, notifications, refused places), `migrations.test.ts`, and `tests/e2e/jobs-page.spec.ts`.
