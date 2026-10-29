# 0118 - A workflow refusal waits for you, and sign-in asks for the workflow scope

Status: accepted

## Context

0104 made GitHub's workflow refusal visible, but Shipping still retried it on its backoff, so the note kept counting `2 tries so far · next at 13:17` for a push that no retry can land.
The friend from 0104 saw it again on a change to `.github/workflows/deploy.yml` and asked why Malini does not push over SSH like plain `git`.
SSH would dodge this one check, because an SSH key has no scopes, but Malini pushes to the canonical `https://` URL with every other protocol denied (`githubPushArgs` in `src/main/git/remote.ts`), and the pull request calls go through the same `gh` token anyway.
The cause was Malini's own sign-in: 0014's `gh auth login --web` asks for `gh`'s default scopes, which leave out `workflow`, so everyone who signed in through setup hit the refusal the first time an agent touched a workflow.
The user: "Yeah, go ahead" to asking for the scope at sign-in and to a one-click fix that stops the retries.

## Decision

- **Sign-in asks for the scope.**
  `GitHubSignIn` in `src/lib/shared/repositories/platform/github-sign-in.service.ts` adds `--scopes workflow` to 0014's `gh auth login` arguments.
- **A refusal no retry fixes waits for you.**
  `workflowRefusal(error)` in `src/main/errors.ts` reads a workflow refusal as `workflow-scope` for an OAuth App, the `gh` sign-in, and `workflow-permission` for a personal access token or a GitHub App.
  `shipFailed` records it in the new `workstream_ship.waits_for` column and `ShipStateRecord.waitsFor`, with no `next_attempt_at` and no alarm.
  `nextShippingMove` answers `held` while `waitsFor` is set, the reader stops polling, and every reset clears it through `NO_SHIP_FAILURE`.
- **The note says so.**
  `ShipFailure` carries `waitsFor`, the note reads `N tries so far · waits for you`, and the `<workstream_shipping>` block tells the agent that only the user can clear it.
- **One click adds the scope.**
  For `workflow-scope`, the note leads with **Allow workflow changes**, which runs `gh auth refresh --hostname github.com --scopes workflow` through the same device-code flow as sign-in: the `repositories.start-github-workflow-access` command, then `repositories.finish-github-sign-in`.
  The one-time code shows in the note through `GitHubDeviceCode`, the panel the GitHub card shares.
- **A new sign-in retries what waits on it.**
  `retryShipsOnGithubCredentialHook` sends **Retry now** for every ship with `waitsFor` once a sign-in or a scope grant succeeds; **Retry now** clears `waitsFor` and tries at once.

## Consequences

- A workflow refusal costs one push, not one every backoff, and the fix is a click instead of a terminal command.
- Every other failure still retries on 0104's backoff, and a terminal `gh auth refresh -s workflow` still works, followed by **Retry now**.
- This narrows 0104's retries and 0014's sign-in arguments; the rest of both stands.
- A held ship does not notice a pull request merged by hand until you press **Retry now** or **Cancel**.
- Enforced by `src/main/errors.test.ts` (`workflowRefusal`), `src/lib/pull-requests/domain/shipping.test.ts` (`held`, no polling), `src/lib/pull-requests/domain/ship-failure.test.ts` (`waits for you`), `src/lib/pull-requests/platform/ship-rule.test.ts` (waits for the scope and for a token, goes on after Retry now), `src/lib/shared/repositories/platform/github-sign-in.service.test.ts` (both `gh` argument lists) and `tests/e2e/ship-failure.spec.ts` (the note waits, and **Allow workflow changes** opens the draft once GitHub approves the code).
