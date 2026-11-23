# 0292 - A shared plan is one file in its own private git repository

Status: accepted

## Context

0290 kept a shared plan as milestones and issues, in the repository itself when it was private and in a private `<name>-malini-plan` beside it when it was public.
Simon turned down both halves.
Milestones and issues tie the plan to one provider and keep no history: "I never wanted to use GitHub specific infrastructure because we may shift to another provider and then we won't have milestones or issues or anything like that", and "it should be just a simple file or repo, like always".
A plan inside a private repository leaks the day that repository turns public: "if someone starts a private repo and they make a plan and then they share it internally and then they decide to put the repo public, they just leak their entire plan".
He picked a separate private plan repository for every repository, public or private, and asked Malini to keep its access in step with the code repository, invitations, removals and stale invitations included: "it is a lot of shores, but at the same time we can abstract all of this bullshit".

## Decision

- Every shared plan lives in `<owner>/<name>-malini-plan`, from `planRepositoryOf` in `initiatives/platform/github-plan.ts`, whether the code repository is public or private.
  The code repository never gets a file, milestone or issue from Malini.
- The plan is one file, `plan.json` on `main`, written by `planFileText` in `initiatives/platform/plan-file.ts`: `{"outcomes": [...]}`, each outcome with `id`, `title`, `dueOn`, `note`, `createdAt` and its `dependencies`, each with `id`, `title`, `done`, `note` and `assignee`, tab-indented with a trailing newline.
  `parsePlanFile` reads it as untrusted input and drops what a hand edit broke; any other file in the repository stays.
- Git is the history and the transport, in `initiatives/platform/plan-git.ts`.
  Malini keeps a bare clone at `<appData>/plans/<owner>/<name>.git`, fetches over HTTPS with the `gh` credential helper, commits with plumbing, and pushes fast-forward only to `main`.
  Each commit names its changes, such as `Rename Launch and 5 more`, and carries the signed-in account's `<id>+<login>@users.noreply.github.com` identity.
- A sync merges three ways in `mergePlan`: the file at `initiative_syncs.synced_commit` is the base, `origin/main` is theirs, and the database is ours.
  Fields merge one by one, every add stays, and a delete wins.
  An unknown base unions both sides.
  A push someone beat is fetched and merged again, up to 3 rounds, then fails with the expected `plan-race` error.
- `gh` stays only for what git cannot do: reading the plan repository, making it, and its access.
  `PlanSyncService.turnOn` makes a missing plan repository private with `POST orgs/{owner}/repos`, or `POST user/repos` for the signed-in account's own, and refuses one in another person's account, or one this account cannot see, with the expected `no-plan-repository` error.
- When the signed-in account is an admin of the plan repository, `accessChanges` keeps it in step with the code repository at turn-on and at most every 10 minutes after:
  it invites each code-repository collaborator with less access than there, removes direct collaborators the code repository no longer has, and cancels invitations for people it no longer has.
  The plan repository's owner and the signed-in account are never touched, and a failed write is logged and skipped.
- Every sync reads the plan repository first and turns sharing off when it is public or gone.
- A change someone else pushed shows as a toast naming the commit's author, and the plan's people are the authors in its last 200 commits.
- The migration adds `synced_commit`, turns every share off, and drops the milestone and issue columns and `initiative_github_deletions`.
  The milestones and issues 0290 made stay on GitHub, and turning sharing on again starts the plan repository.

## Consequences

- A plan is a plain file with a full git history, so another git host needs a new reader for access and repository creation, and nothing else.
- Turning the code repository public leaks nothing, since the plan was never in it.
- Only the owner can make the plan repository of a repository in a personal account other than the signed-in one.
- Someone who loses access to the code repository loses it to the plan within 10 minutes of a sync by an admin, not at once.
- Enforced by `src/lib/initiatives/platform/plan-sync.test.ts` on real SQLite and a real bare git remote with a fake `gh` (the plan lands as `plan.json` in the private plan repository for a public and a private code repository; access is invited, removed and cancelled; a teammate's commit merges and is announced; a beaten push retries; a public or gone plan repository turns sharing off), `plan-file.test.ts` (the file's checks, the merge and the commit message), `src/main/db/migrations.test.ts` (every share turns off and the plan keeps its rows), and `tests/e2e/initiatives.spec.ts` in the built app.
