# 0023 - Merge blockers clear themselves

Status: superseded by 0086

## Context

The pull request bar told the user about blockers Malini can clear itself: "Behind main", "Conflicts with main" and a reviewer's "Changes requested".
The user's words: "if a work stream is one commit behind main, there should be a job that resolves this problem automatically", "we shouldn't leak this detail to users", and "if someone requested changes, we should have a job that will go after that and fix stuff".
Until now **Update from main** ran only when a workstream opened, and **Address bot review** only took bot feedback: a person's change request stopped the queue with **Needs you**.
A queue stopped on **Needs you** also stayed stopped after the user fixed the cause, until they found **Retry** in the pull request menu.

## Decision

- Every pull request status the renderer reads (`pull-requests.status` with a `workstreamId`) goes to `MergeQueue.pullRequestRead` in `src/lib/pull-requests/platform/merge-queue.service.ts`.
  Main moving (`behindBase > 0` or GitHub reporting a conflict) requests **Update from main**, and `changes_requested` requests **Address review**, at most once a minute per workstream, for a workstream that is not queued.
- The built-in `address-review` job is now **Address review**: it takes every standing change request, bot or person, the threads of the people who requested changes, and bot threads (`reviewToAddress` in `src/lib/pull-requests/domain/merge-queue.ts`).
  A comment-only thread from a person still stops the queue with **Needs you** ("Reviewer needs a reply").
  Review content stays untrusted data in the job context, never instructions.
- Each change request is addressed once: the review ids a successful job addressed go to `workstream_ship.addressed_reviews` (migration 50).
  After that the queue waits for the reviewer (`waiting-for-review`) instead of running the job again.
- A queue on **Needs you** re-checks itself every `reviewPollMs` (two minutes) and resumes as soon as the next move is no longer the same stop, archiving a pull request merged on GitHub meanwhile.
- The bar never says "Behind main" or "Conflicts with main".
  While one of the three shipping jobs runs outside a queued merge it says **Clearing blockers** with neutral buttons; the queued merge detail says the same.

## Consequences

- The user sees what needs them, not git plumbing: a branch behind main reads as ready until the update job runs.
- An agent now runs on a person's review without a click, so a reviewer's words reach the agent; the untrusted-data framing in `pull-request-fix-prompt.ts` must stay.
- A reviewer who never re-reviews leaves a queued merge waiting for review indefinitely, like a required approval already did.
- Enforced by `src/lib/pull-requests/domain/merge-queue.test.ts` (review routing, once per review, waiting for the reviewer), `src/lib/pull-requests/platform/merge-queue.service.test.ts` (read-triggered jobs, the self-resuming queue), `src/lib/pull-requests/domain/pull-request-top-bar.test.ts` (no behind or conflict line, **Clearing blockers**), `src/main/db/migrations.test.ts` (v50) and `tests/e2e/pull-request-blockers.spec.ts`.
