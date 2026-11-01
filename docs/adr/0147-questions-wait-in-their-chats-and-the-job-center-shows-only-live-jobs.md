# 0147 - Questions wait in their chats, and the Job center shows only live jobs

Status: accepted

## Context

0085 put every question Malini asks under **Waiting for you** in Activity, apart from the job it was about, and the Job center listed what ran, a **Recent** fold of what finished, and an **Upcoming** list of schedules.
A question cleared only when you answered it, so archiving its workstream left it behind: the person found seven asks about workstreams archived days earlier, each offering to run a job or wake a chat about work that was gone.
A second conflict in the same workstream added a second question instead of replacing the first.
Their words: "questions should be on their jobs, not in some center", and the gutter "should be just showing active and queued jobs always, not have "recent" row. I never click it, and when i do its too overwhelming."
They picked variant A (Inline) of three prototypes, without a time column running down the side of a question.
Built, its rows were too tall, and a row that only said a job "wants to run" gave nothing to decide on: "if something needs me, I should be able to go to somewhere to take an action, right? to like gather context, make a call".
Of three more prototypes they picked variant A (In its chat): one line per job, and the call made in the chat the job is about.

## Decision

- `jobCenterEntries` in `src/lib/jobs/domain/job-center.ts` builds the Job center from live entries only: each asking decision on the run it is about, a waiting or needs-you run, then running, then queued, oldest first within each.
  Finished runs and schedules are not in it; their place is the job's page and Activity.
- Every entry in the Job center is one line.
  `JobQuestionLink` names the job, where it runs and why it needs you (`jobQuestionReason`: **Conflicts**, **Failed**, **Wants to run**, **Asks you**), and links to where you answer: its workstream's chat, the transcript of a run whose agent asks you, or the job's page for a run that waits before it has a chat.
- `JobQuestionRow` is the call, above the composer of that chat and under **Needs you** on the job's page: the job and its time, the question, or for a run that asks first when it runs, what it does and how its last run went, and the answers as buttons: **Run it** and **Skip**, or the decision's choices as **Run again**, **Tell its chat**, **Dismiss**.
  `JobRunList` shows calls where `asksHere` is set and links everywhere else.
- `reconciler_decisions.subject_run_id` names the job run a question is about, backfilled from `event_log.cause_id`, and `jobs.list-runs` always returns the runs asking questions are about.
- `ReconcilerService` dismisses a question when its workstream is archived or deleted (`repositories:workstream-removed`, and at start for any already closed, dated when it was archived so Activity keeps it in its place), when a newer run of the same job in the same workstream succeeds or fails, and when a newer question about the same job or workstream arrives; it asks nothing about a closed workstream.
- `JobRunner.close` cancels a closed workstream's unfinished runs, on removal and at start, with the detail "Its workstream was closed."
- The docked Job center in a workstream stays as the way into the Jobs page (0146), saying "ready when you are" while nothing is live; the floating one shows only while an entry is live.
- Activity keeps only history, and the Jobs badge on Activity is gone; the Jobs page marks a job that asks you.
- This replaces 0085's line on asks: "An ask waits under **Waiting for you** in Activity with a button per candidate, counts toward the Jobs badge and notifies".
  The rest of 0085 stands, and a notification's title is now the job and its workstream.

## Consequences

- A question is answered in the chat it is about, next to what that chat last did, and one that can no longer be acted on is never shown.
- Answering takes one click more than a button in the gutter, which is the price of seeing the context first.
- What finished and what is scheduled is one click further, on the Jobs page.
- Every path that ends a workstream must emit `repositories:workstream-removed`, or its questions and queued runs wait until the next start.
- Enforced by `src/lib/jobs/domain/job-center.test.ts`, the "a question on its job" and "the jobs of a closed workstream" tests in `src/lib/jobs/platform/reconciler.service.test.ts`, and `tests/e2e/event-reconciler.spec.ts`, `tests/e2e/jobs.spec.ts` and `tests/e2e/job-runs.spec.ts`, which follow a question's line from the Job center to its chat, answer it there, and see one go away with its workstream.
