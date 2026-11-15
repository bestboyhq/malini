# 0251 - The base branch comes from origin at each new workstream

Status: accepted

## Context

0041 and 0052 had connecting a repository pass its default branch to `repositories.create-repository`, read once from `gh repo view`, and every new workstream fetched `refs/heads/<that branch>` from origin.
When `gh` failed, the host was not GitHub, the folder had no `origin/HEAD` or the repository was empty, seven places guessed `main` instead.
A repository whose only branch is `master`, or whose default branch was renamed after it was connected, then failed every new workstream with "couldn't find remote ref refs/heads/main", and it happened to users more than once.
The e2e harness made only `main` repositories, so no test could catch it.
The user asked for Malini to be "error resistant": "whenever we have an error like that, it's our failure", and "we should really get out of people's way".

## Decision

- `readOriginHead` (`src/main/git/remote.ts`) asks origin with `git ls-remote --symref origin HEAD` from the base clone, with the gh credential helper, and tells an empty origin (no `HEAD`, no `refs/heads/*`) from one that names no default branch.
- `repositories.read-base-branch { projectRepoPath, projectId }` (`readBaseBranch` in `workstreams.service.ts`) runs it at each new workstream and saves the answer on the project row and on each connected repository row of that project, emitting `repositories:changed` once when one changed.
  When origin cannot answer, it uses the last branch it saved, and with none it fails.
- Every path that starts a workstream asks it first: provisioning in the renderer (`provisionWorkstreamCommand`, which also puts the branch on the provisioning plan), `createPlannedWorkstream` for agent tools and automations, and a workstream an extension opens without its own base.
- An empty origin fails the copy step with "Empty repository. Push a first commit, then retry", and an origin with branches but no `HEAD` and nothing saved fails with "Origin names no default branch. Set one, then retry".
- Every `main` fallback is gone: `repositories.create-repository` and `CreateProjectArgs` drop `defaultBranch`, `readDefaultBranch` takes its fallback from the caller, and a connected row without an answer keeps `''` until the first workstream reads origin.
- A clone made from a local folder reads origin's `HEAD` after its fetch, checks that branch out and sets `origin/HEAD` with `git remote set-head`, instead of trusting the branch it was handed.
- `repositories.list-clones` refreshes only the identity fields of each row, so it never writes an old default branch over the one origin named, and a pull request's base no longer overwrites a project's default branch.

## Consequences

- A `master`-only repository, a renamed default branch and a repository that is not on GitHub all start workstreams without help.
- Each new workstream makes one more round trip to origin; it already fetched from there, so a working connection is no new requirement.
- An empty repository still cannot get a workstream, since diffs, checkpoints and shipping need a base commit; a first commit made by Malini would push to the user's remote, so it waits for the user.
- Workstreams that already exist keep the base branch they started on, even after origin renames it.
- `''` is the only "not known yet" value for a default branch; nothing may guess a name again.
- Enforced by three tests in `tests/e2e/workstream-setup.spec.ts` (a `master`-only repository, a renamed default branch, an empty repository that starts once it has a commit) and by `workstreams.test.ts`, which renames origin's branch and then removes origin to check the saved fallback.
