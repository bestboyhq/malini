# 0162 - A push without write access names the account and waits for you

Status: accepted

## Context

The user clicked **Draft** in a workstream of `tester-army/e2e`, a public repository their `gh` account `szymeo` can read but not push to (`permissions.push: false`).
GitHub answered the push with `remote: Permission to tester-army/e2e.git denied to szymeo.` and a 403.
`gitFailureVerdict` in `src/main/errors.ts` read both lines as `auth-failed`, so the reason said "GitHub rejected the sign-in", which was false: the sign-in worked.
`shipFailed` treats `auth-failed` in a draft as a sign-in the repository surface shows, so it reset the step with no failure count, and the bar went back to **5 files changed** with the reason only in a tooltip.
The user: "It like starts to open pull request and then kinda goes back to the default state."
No retry fixes a missing permission, the same way 0118 found no retry fixes a missing workflow scope.

## Decision

- **A denied push is its own kind.**
  `gitFailureVerdict` reads `Permission to <repo> denied to <account>` and `Write access to repository not granted` as `push-denied`, before the sign-in patterns, and `AUTH_FAILURE` no longer matches `permission to … denied`.
  The reason names who and where: "`szymeo` can't push to tester-army/e2e. Ask its owners for write access, then retry.", or "This GitHub account" when GitHub names nobody.
  A 401, missing credentials and a rejected SSH key stay `auth-failed`.
- **It waits for you.**
  `workflowRefusal` becomes `waitsForYou(error)`, which answers `push-access` for `push-denied` and 0118's two workflow values otherwise.
  `ShipWaitsFor` in `src/contract/pull-requests.ts` gains `push-access`, so `shipFailed` holds the ship with no `next_attempt_at`, the bar reads **Couldn't open draft · 1 try since 17:31**, and the note reads **waits for you** with **Retry now** and **Cancel draft**.

## Consequences

- A push to a repository you cannot write costs one try and says why, instead of looking like nothing happened.
- Opening a pull request from a fork is still not something Malini does; the note asks for write access.
- 0118's decision stands; only the function name it cites changed.
- Enforced by `src/main/errors.test.ts` (`names who cannot push where`, `waits for write access GitHub denied`) and `src/lib/pull-requests/platform/ship-rule.test.ts` (`says the account cannot push to the repository, and waits for you instead of resetting`).
