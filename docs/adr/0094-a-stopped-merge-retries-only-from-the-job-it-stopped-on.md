# 0094 - A stopped merge retries only from the job it stopped on

Status: accepted

## Context

The pull request bar offered **Retry** for every merge that stopped to need you (0086), next to a one-line reason.
The user: "I think it should be possible to retry only from within the job, not from outside of it. Because if you don't know the details, what's the point of retrying?"
Only a fix job that gave up has details behind the stop; a reviewer to answer, GitHub blocking the merge, a closed pull request, an expired GitHub sign-in or a git operation stopped part-way is fixed outside Malini, and Shipping looks again when the reader logs a change, HEAD moves or a retry alarm fires (0086).
A fix you made in the chat right after a stop never resumed the merge: Shipping looked during the 5 seconds it waits after a turn ends, read "the agent works" as nothing changed, and never looked again.

## Decision

- **No Retry in the bar.**
  The pull request bar and its detail lose **Retry** for every stop; **Cancel merge** stays.
- **Retry merge in the job.**
  When a merge stops because its fix job gave up, **Open job** shows that job's chat, which says why the merge stopped and offers **Retry merge**, logging the same **Button clicked** `retry`.
  The bar's sentence for that stop sends you to the job; every other stop says the merge picks up on its own once it is resolved.
- **A stop looks again after a turn.**
  Shipping re-checks a stopped merge once the 5 seconds after a turn pass, so a fix you make in the chat resumes it.
- **An aborted git operation resumes the merge.**
  Shipping hears **Files changed** while a merge waits on a git operation stopped part-way (`RULE_EVENTS`), since aborting a cherry-pick or a revert that made no commit leaves HEAD where it was; the Explorer gives **Files changed** a row of its own.

## Consequences

- A retry always comes with the job's transcript in view, never blind.
- A stop without a job has no button, so it must resume on its own: a cause it never notices is a bug in Shipping, not a missing button.
- This changes 0086's **Retry** in the pull request bar; the rest of 0086 stands.
- This changes 0091's list of the events Shipping hears; the rest of 0091 stands.
- Enforced by `src/lib/pull-requests/platform/shipping.service.test.ts` (a fix in the chat resumes a stopped merge, and so does aborting the git operation that stopped it), `src/lib/pull-requests/domain/pull-request-top-bar.test.ts` (no Retry in the bar, the sentence that sends you to the job), `src/lib/pull-requests/domain/pull-request-ship.test.ts` (which stop names a job), `src/lib/jobs/domain/explorer.test.ts` (a row for every event a rule hears) and `tests/e2e/merge-queue.spec.ts` (a blocked merge resumes once GitHub unblocks, and **Retry merge** in the job's chat queues it again).
