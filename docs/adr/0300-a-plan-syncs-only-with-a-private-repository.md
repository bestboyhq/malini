# 0300 - A plan syncs only with a private repository

Status: superseded by 0303

## Context

0299 synced a repository's plan into that repository's own milestones and issues, so a public repository published its plan to anyone.
Simon ruled that out: "i dont want to expose it at all, storing it publicly isnt an option".
He still wants the plan shared on a public repository, with the people he builds it with: "if I work with someone on a public repo, I would like the someone to know if they are a collaborator. But non everyone else."
He picked a private repository beside the public one, with a name that marks it as Malini's: "repo name should be marked with some more specific to malini name".
GitHub has no private milestones or issues in a public repository, and his `gh` sign-in has no `project` scope, so a private repository is the one place `gh` can keep the plan for collaborators only.

## Decision

- A plan syncs with its home, which is always a private repository.
  A private repository is its own home.
  A public repository's home is `<owner>/<name>-malini-plan`, from `planRepositoryOf` in `initiatives/platform/github-plan.ts`.
- `initiatives.set-sync` turns sync on through `PlanSyncService.turnOn`:
  - It reads `repos/{owner}/{name}`, and refuses one that is missing with the expected `not-on-github` error.
  - For a public repository it reads the home, and refuses a public home with the expected `public-repository` error.
  - A missing home is made private with `POST orgs/{owner}/repos`, or `POST user/repos` when the owner is the signed-in account; in another person's account it refuses with the expected `no-plan-repository` error.
  - It lists the public repository's collaborators and grants each one, but the signed-in account, the access they have there with `PUT repos/{home}/collaborators/{login}`, unless the home already grants as much or an invitation waits; a failed invitation is logged and skipped.
- `initiative_syncs.home` stores the home as sync turns on.
  A different home than the stored one clears every row's GitHub links, pending deletions and last sync, so no write reaches a milestone or issue number of another repository.
- Every sync and push reads the home first, and turns sync off, writing nothing, when it is public or gone; a failed read writes nothing either.
  Every milestone, issue and event path goes to the home, and the plan rows stay keyed by the repository they belong to.
- `initiatives.sync-state` reports `home`: the stored one while sync is on, otherwise the one turning it on would use, or `null` when GitHub cannot say.
  The switch shows only when `home` is set, and its line names the home and who sees it.
- Everything else in 0299 stands: outcomes are milestones, dependencies are issues, a merge closes its issue, and the plan pulls every 30 seconds while on screen and pushes after each edit.

## Consequences

- A team on a public repository shares its plan with its collaborators only, and the public repository never gets a milestone or issue from Malini.
- Collaborators added to the public repository later get their invitation only the next time someone turns sync on.
- Making the plan repository needs the right to make repositories in the owner's organization, or the owner's own account.
- Enforced by `src/lib/initiatives/platform/plan-sync.test.ts` on real SQLite with a fake `gh` (a public repository's plan goes to a private plan repository its collaborators are invited to, and never to the public one; a public plan repository is refused; a private repository that turns public stops before its next write, and a new home starts unlinked), and `tests/e2e/initiatives.spec.ts` in the built app.
