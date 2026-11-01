# 0147 - Questions live on their jobs, and the Job center shows only live jobs

Status: accepted

## Context

0085 put every question Malini asks under **Waiting for you** in Activity, apart from the job it was about, and the Job center listed what ran, a **Recent** fold of what finished, and an **Upcoming** list of schedules.
A question cleared only when you answered it, so archiving its workstream left it behind: the person found seven asks about workstreams archived days earlier, each offering to run a job or wake a chat about work that was gone.
A second conflict in the same workstream added a second question instead of replacing the first.
Their words: "questions should be on their jobs, not in some center", and the gutter "should be just showing active and queued jobs always, not have "recent" row. I never click it, and when i do its too overwhelming."
They picked variant A (Inline) of three prototypes, without a time column running down the side of a question.

## Decision

- `jobCenterEntries` in `src/lib/jobs/domain/job-center.ts` builds the Job center from live entries only: each asking decision on the run it is about, a waiting or needs-you run, then running, then queued, oldest first within each.
  Finished runs and schedules are not in it; their place is the job's page and Activity.
- `JobQuestionRow` shows a question inline on its job: the job and where it runs, the question with its time at the end of the line, and its answers as buttons: **Run it** and **Skip**, **Open chat**, or the decision's choices as **Run again**, **Tell its chat**, **Dismiss**.
  The chat's strip above the composer shows its workstream's entries through the same `JobRunList`.
- `reconciler_decisions.subject_run_id` names the job run a question is about, backfilled from `event_log.cause_id`, and `jobs.list-runs` always returns the runs asking questions are about.
- `ReconcilerService` dismisses a question when its workstream is archived or deleted (`repositories:workstream-removed`, and at start for any already closed, dated when it was archived so Activity keeps it in its place), when a newer run of the same job in the same workstream succeeds or fails, and when a newer question about the same job or workstream arrives; it asks nothing about a closed workstream.
- `JobRunner.close` cancels a closed workstream's unfinished runs, on removal and at start, with the detail "Its workstream was closed."
- The docked Job center in a workstream stays as the way into the Jobs page (0146), saying "ready when you are" while nothing is live; the floating one shows only while an entry is live.
- Activity keeps only history, and the Jobs badge on Activity is gone; the Jobs page marks a job that asks you.
- This replaces 0085's line on asks: "An ask waits under **Waiting for you** in Activity with a button per candidate, counts toward the Jobs badge and notifies".
  The rest of 0085 stands, and a notification's title is now the job and its workstream.

## Consequences

- A question is answered where its job is, and one that can no longer be acted on is never shown.
- What finished and what is scheduled is one click further, on the Jobs page.
- Every path that ends a workstream must emit `repositories:workstream-removed`, or its questions and queued runs wait until the next start.
- Enforced by `src/lib/jobs/domain/job-center.test.ts`, the "a question on its job" and "the jobs of a closed workstream" tests in `src/lib/jobs/platform/reconciler.service.test.ts`, and `tests/e2e/event-reconciler.spec.ts`, `tests/e2e/jobs.spec.ts` and `tests/e2e/job-runs.spec.ts`, which answer questions in the Job center and see one go away with its workstream.
