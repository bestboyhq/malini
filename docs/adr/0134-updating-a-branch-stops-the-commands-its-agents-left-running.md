# 0134 - Updating a branch stops the commands its agents left running

Status: accepted

## Context

A run stays open while its background commands run (0009), yet a turn that ends over them reads as finished, and Shipping goes on (0037, 0122): its idleness check, `chat.workstream-has-working-run`, skips a run that waits only on background commands.
Merging the base branch into a workstream moves its checkout, and `AgentRunLeases.acquireCheckoutMove` refuses while any run is open, because a run's changes are captured against its start snapshot when it ends, so a merge inside it would count as the agent's changes and its undo would revert them.
So a queued merge whose pull request was behind main, in a workstream whose agent had left a dev server running, failed at **Update branch** with "`01J9BAED0DA070443BBA919FEA` already has an active run", and retried on its backoff, and on every **Retry now**, until the command stopped.
The report: "dlaczego nie moze tego zupdatowac" ("why can't it update this"), "Chce wiedziec, dlaczego nie moze" ("I want to know why it can't"), after six retries.
**Update from main** failed the same way, a run of its own included, before a scheduled job.
Archiving already met the same lease: it stops the workstream's background commands and waits for their run's change capture before it takes the teardown lease (0082).

## Decision

- **An update clears its way.**
  `repositories.pull-workstream`, which the Merge flow's `update-branch` step, **Update from main** and a repository extension's pull call, moves the checkout through `guardBranchUpdate` instead of `guardCheckoutMove` (`src/lib/shared/repositories/platform/register.ts`).
  `guardBranchUpdate` in `src/main/modules.ts` first runs what archiving runs, `stopBackgroundCommands`: `chat.stopWorkstreamBackgroundCommands`, then `runChangeCaptureSettled`; then it takes the checkout move lease.
  `stopWorkstreamBackgroundCommands` stops nothing while an agent is working, so a working agent still holds the update.
- **Other checkout moves stay quiet.**
  A fast-forward at creation or of your own pull request, and restarting a merged workstream on its base, keep `guardCheckoutMove` and stop nothing.
- **The refusal reads in words.**
  The checkout move lease refuses with its own `LifecycleError` kind, `checkout_busy`: "An agent is still working in this workstream, so its branch can't move yet.", instead of the workstream id with "already has an active run".
  Diagnostics log it as a warning, like `already_running` (`EXPECTED_FAILURE_KINDS` in `src/main/diagnostics/main-diagnostics.ts`).

## Consequences

- A queued merge behind main no longer waits on a dev server: the dev server stops, the branch updates, and the merge archives the workstream, which would have stopped it anyway.
- A merge you **Keep** (0095), and an **Update from main** you run, stop the agents' background commands too; ask the agent to start them again.
- An agent that waits on a finite command, such as a test suite, loses it when an update comes, the same trust in a turn's early end that Shipping already gives it (0122).
- This narrows 0037's "Shipping still waits until the commands stop" and 0095's kept background commands for a branch update; the rest of each stands.
- Enforced by `tests/e2e/update-from-main.spec.ts` ("a merge behind main stops the background command its agent left running, then updates the branch and merges") and `src/lib/chat/platform/agent/lifecycle.test.ts` (the checkout move refusal).
