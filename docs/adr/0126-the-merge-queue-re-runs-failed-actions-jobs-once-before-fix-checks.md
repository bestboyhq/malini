# 0126 - The merge queue re-runs failed Actions jobs once before Fix checks

Status: accepted

## Context

A failing check used to start **Fix checks** at once, flake or not.
On pull request #109, a quit stall in `e2e on macOS 3/5` started a Fix checks agent that could not reproduce it and ran `gh run rerun --failed` on its own.
GitHub then showed the check running again with no failure, while the top bar still said **Clearing blockers**, and nothing explained why an agent was fixing checks that had not failed.
A re-run costs no agent, and an agent told that the failure already repeated fixes the cause instead of re-running it.

## Decision

When the Shipping rule meets a failure signature it has not met in this queued merge, and every blocking check links to a GitHub Actions job (`/actions/runs/<run>/job/<job>`), it moves `rerun-checks`.
`pull-requests.rerun-failed-checks` posts `repos/<owner>/<repo>/actions/runs/<run>/rerun-failed-jobs` once per run, and `workstream_ship` keeps `checks_rerun_at` and `checks_rerun_head_sha` with the signature at zero attempts.
The step `rerunning-checks` holds while those checks run again on that head, and Malini reads GitHub every 45 seconds meanwhile.
When they fail again after the re-run, or still show the old failure a minute later, Fix checks runs as attempt 1, and its context says Malini already re-ran them.
Every Fix checks context says never to re-run a check in place of a fix, and the built-in instructions say so too.
A check with no Actions job link, or a re-run GitHub refuses, goes straight to Fix checks.
`blockingChecks` in `pull-requests:pull-request-changed` carries each check's `url`, and `pull-requests:ship-changed` carries `checks`, the names in the failure signature, so the top bar reads **Re-running e2e on macOS 3/5** and then **Fixing e2e on macOS 3/5**.

## Consequences

A flake clears without an agent, and the pull request keeps both attempts on GitHub.
A real failure waits one more CI run before an agent sees it.
Each failure signature gets one re-run per queued merge; queuing, retrying or cancelling clears the signature, so the next queue re-runs again.
`src/lib/pull-requests/domain/shipping.test.ts` and the two re-run tests in `tests/e2e/merge-queue.spec.ts` fail when the re-run, its hand-off to Fix checks or the named top bar breaks.
