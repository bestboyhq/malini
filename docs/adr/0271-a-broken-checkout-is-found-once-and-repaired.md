# 0271 - A broken checkout is found once and repaired

Status: accepted

## Context

In the field log of Malini 0.131.0, one Mac sent `workstream-files` 147 times in 4 minutes, each a git read of a checkout that could not be read.
Every poll of a workstream's files, status and change totals spawned git again, and every failure became one more error line.
The user could not see that the checkout was broken, and nothing in Malini could put it back.
The causes in that log and in git's own messages are few: a missing folder, `.git` link or admin folder, a stale `index.lock`, a corrupt index, a bad `HEAD`, a repository git does not trust, missing developer tools, no permission and a full disk.
The user asked for "no field error is unreadable, silent or repeated".

## Decision

- `CheckoutHealthGuard` in `src/lib/shared/repositories/platform/checkout-health.ts` wraps every checkout read: `readCheckout` in the repositories platform, the extensions' file reads and `pull-requests.status`.
- A read that fails with a checkout-class error, `isCheckoutFailure`, runs the doctor once and rethrows its own error.
  Checkout-class means a missing file, `GitError` `not-a-repo`, `git-unavailable` or `worktree-busy`, or a `git` error whose `said` names the checkout.
  When the doctor finds nothing, the checkout stays healthy and nothing is emitted.
- Once a checkout is `broken`, each later read fails at once with `WorkstreamError` `checkout-broken`, an `expected` kind, and spawns no git.
- `diagnoseCheckout` in `checkout-doctor.ts` reads the folder, the `.git` link, the admin folder, the lock, the index and `HEAD` before it asks git, and names one finding from `CHECKOUT_FINDINGS` in `$contract/repositories`.
- `repairCheckout` repairs `folder-missing`, `git-link-missing`, `admin-missing`, `stale-lock`, `index-corrupt` and `head-invalid`; the other findings are for the user or the Mac to fix.
  - It moves each file or folder it replaces to `<common git dir>/malini-repairs/` first, and it never touches working files.
  - A lock goes only when it is older than 2 minutes, `lsof` shows no process holding it and no git runs in the checkout.
  - A missing folder is recreated from its branch, then its newest checkpoint, run-change or baseline snapshot on that branch is restored.
- A broken checkout probes again after 5 seconds, doubling up to 5 minutes, and at once when a Malini window gets focus.
- Every change of state emits `repositories:workstream-checkout-health` with `state`, `finding` and `repairable`.
  `repositories.checkout-health` reads the state and `repositories.repair-checkout` runs the repair.
- The chat shows a banner that names the finding, with **Repair** when the finding is repairable.
  0273 replaces the banner with a setup step and the top bar status.
- A `broken` state sends one error line, `checkout broken: <finding>`, with `finding` as its only fact (0270, 0272).

## Consequences

- A broken checkout costs one git spawn and one error line, not one per poll.
- The user sees what broke, and Malini repairs the common cases without losing work.
- A new checkout-class failure needs a `said` value, a finding and a doctor check, or it repeats as a plain failure again.
- Every reader of a checkout must go through the guard, or it spawns git against a broken checkout.
- `checkout-health.test.ts` fails when 50 reads of a broken checkout spawn git more than once, or when the first read loses its own error.
- `checkout-doctor.test.ts` fails when a finding is misnamed under real git, or when a repair loses the working files.
- A write into a checkout's git folder, such as the exclude rule, never recreates a git folder that is gone, or the doctor names the wrong finding.
  `excludes.test.ts` fails when it does.
- `tests/e2e/checkout-health.spec.ts` fails when the banner or **Repair** stops working (the setup step, since 0273).
