# 0086 - Shipping is events and handlers, not a merge queue

Status: accepted

## Context

0023 had the merge queue start Update from main and Address review from every pull request read the pull request bar made, and 0085 kept its own polls of GitHub and its reactions to reads that changed nothing, so the queue still decided from data the event log never saw: a second "changes requested" review with the same thread count started Address review with no event of its own.
The merge queue was a loop of its own: timers per workstream polled GitHub every 15 seconds, retried, waited for agents and jobs, and it listened to agent and job updates the event log does not keep.
It also logged Malini's own intents as events: queueing a merge emitted `pull-requests:merge-requested`, which the reconciler handed straight back to the merge queue, and the click that started it was never logged.
The user: "we should almost never have something requested events, cause when i click a btn - a btn got clicked, not merge requested", and "Merge queue shouldnt be fetching events on its own. I dont even know if we should have a merge queue. System is just events and handlers".
The state a handler needs is cheap to read fresh: on a copy of the user's database (350 workstreams, 327,000 agent events) the state of all 16 active workstreams reads in 0.5 ms and `git status` of a checkout takes 10 to 20 ms, so the rule reads it on each event rather than keeping a second copy that updates itself.

## Decision

- **A click is an event.**
  The pull request bar's Draft, Merge, Retry and Cancel call `pull-requests.button-clicked` with the `button`, which records what you asked for in `workstream_ship` and emits `pull-requests:button-clicked` (**Button clicked**) with the workstream's new state.
  Opening a workstream calls `pull-requests.workstream-opened`, which emits `pull-requests:workstream-opened` (**Workstream opened**).
  `pull-requests:draft-requested`, `pull-requests:merge-requested`, `pull-requests.retry-merge` and `pull-requests.cancel-merge` are gone.
  The Open draft and Merge jobs still call `pull-requests.open-draft` and `pull-requests.queue-merge`, which emit `pull-requests:ship-changed`; their own Job finished moves the workstream on.
- **The Shipping rule.**
  `Shipping` (`src/lib/pull-requests/platform/shipping.service.ts`) replaces `MergeQueue` and is the reconciler's `shipping` rule.
  It hears only logged events: Button clicked, Workstream opened, Pull request changed, Turn finished, Job finished, Head moved while it needs you, Time reached, Workstream archived and Malini started.
  On each it builds the workstream's state from the `workstream_ship` row, its job runs and chat turns, the latest Pull request changed and the checkout's status, and takes the next move from `nextShippingMove` (`src/lib/pull-requests/domain/shipping.ts`), whose moves are the merge queue's.
  What it must remember between events lives in `workstream_ship` (migration 68): the push, update and review requests it has not acted on, settled by compare-and-set, the failures behind its backoff, and the job whose work is not committed yet (`settled_job_run_id`).
  A Then that a shipping job starts takes over from it when that job finishes (`activeThenJobRun`).
  It sets no timer of its own; the one pause inside a reaction is the 5 seconds after a turn ends that let a prompt queued in the renderer start first.
- **The GitHub reader.**
  `PullRequestReader` (`pull-request-reader.service.ts`) is the only code that learns a pull request's state: the bar's reads and the rule's reads go through it.
  It reads on its own only while shipping waits on GitHub (`pullRequestReadEvery`): every 15 seconds for a queued merge, 45 while checks run, 2 minutes while a review or you are awaited, never while an agent or a job works.
  Pull request changed carries every fact the rule decides on (`pullRequestChange`): whether checks are pending, each blocking failure with when it finished, the ids and authors of change requests and unresolved threads, mergeability, and whether and how you may merge, so a read that logs nothing has nothing new to act on.
  A read from before GitHub took a push in logs nothing and leaves the rule waiting for GitHub, and the rule forgets its cached read after anything it does on GitHub and on every click.
- **A wait with an end is an alarm.**
  `setAlarm` (`jobs.platform.ts`, table `alarms`, migration 68) keeps one wait per workstream: `retry` after a failed step, backing off from 30 seconds to 10 minutes, and `checks`, the minute a fix gets for its failing checks to run again.
  The jobs clock checks alarms every second and fires each due one as `jobs:time-reached` with `{ workstreamId, wait, due }`, which the log attributes to the work last done in that workstream.
- **Names.**
  The rule is **Shipping** in the code and the Explorer, and its listed events are **Button clicked** and **Workstream opened** with the source You.
  The settings keys `merge-queue.*` and the job run origin `merge-queue` stay, because they are stored.

## Consequences

- Every shipping job names the read or the click that started it, and nothing in shipping starts from a timer or a read that logged nothing.
- A second change request with the same counts is a new Pull request changed and starts Address review again, named as its cause.
- Outside a merge, Update from main runs when you open a workstream, at most once a minute, or when a Pull request changed shows main moved; it no longer retries every five minutes on a read that shows nothing new.
- A merge that needs you looks again when the reader logs a change, git moves HEAD or a retry alarm fires after a failed step, so reconnecting GitHub resumes it at the next retry rather than within two minutes.
- Each reaction reads the state fresh: about half a millisecond of SQLite on the user's data and one `git status`.
- 0023's jobs and copy still hold: Update from main and Address review clear blockers on their own, each change request is addressed once, and the bar never says "Behind main".
- Enforced by `src/lib/pull-requests/domain/shipping.test.ts` (the moves, the facts a read logs, a second review telling itself apart, when the reader reads), `src/lib/pull-requests/platform/shipping.service.test.ts` (clicks logged and heard, the Merge job's Job finished, unchanged reads starting nothing, a second review naming its own read, backoff through alarms, a restart), `src/lib/jobs/platform/event-log.service.test.ts`, `src/lib/jobs/domain/explorer.test.ts`, `src/main/db/migrations.test.ts` and `tests/e2e/merge-queue.spec.ts`.
