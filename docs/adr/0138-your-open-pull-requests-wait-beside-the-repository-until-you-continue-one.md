# 0138 - Your open pull requests wait beside the repository until you continue one

Status: accepted

## Context

0041 turned every pull request you have open in a repository into a workstream, when you connected it and every five minutes after, on every Mac (0021 before it).
On the user's Mac, pull requests opened on another Mac became workstreams here, merged there minutes later, and stayed active here, shown as merged in the sidebar.
When 0137 started merging main into workstreams, it ran Update from main on seven of them in `ablaszkiewicz/gardener-game`, and Resolve conflicts on them.
The user: "I don't think we should automatically synchronize pull requests for some repository. I think this is too extreme."
And: "it should be just a simple gutter on the right with your open PRs in this repo and on hover action to continue that workstream here".
Each adopted pull request also cost a worktree and a dependency install on every Mac, whether the user meant to work on it there or not (0041).

## Decision

- Malini opens no workstream for a pull request on its own.
  Connecting a repository runs no sync, the five-minute poll (`followOwnPullRequestsHook`) is gone, and so is `repositories.sync-own-pull-requests`.
- The repository page (`src/lib/app/presentation/pages/RepositoryPage.svelte`) shows `OwnPullRequests.svelte`, a gutter on its right, for a repository with a GitHub owner.
  It lists your open pull requests from `repositories.list-own-pull-requests`, which runs `gh pr list --author @me --state open` in the repository's clone each time the page opens and leaves out forks.
  Each row shows the title, the number, whether it is a draft, when it last changed, and on hover **Continue here**, or **Open** when its workstream is active here.
- A click runs `repositories.continue-own-pull-request` (`src/lib/shared/repositories/platform/own-pull-requests.service.ts`), which reads the list again and acts only on a pull request still in it.
  It opens a missing workstream on the pull request's own branch, restores an archived one, or fast-forwards an active one to the head GitHub has, and the page then opens that workstream.
- What 0041 set for the workstream itself still holds: a `malini/<id>` head keeps its id, any other head gets `pr-<hash>`, the worktree sits on the pull request's own branch, Claude names it from its title, and every guard compares a checkout with the workstream's recorded branch.
- `deleted_workstreams` is dropped (migration 83), since it existed only to keep the sync from opening a pull request you had deleted.

## Consequences

- A pull request merged or closed on another Mac never turns into work here, and you choose which of your pull requests cost a worktree on this Mac.
- Work from another Mac no longer shows up in the sidebar by itself: you continue it from the repository page, and a workstream already active here catches up with that Mac's pushes when you continue it.
- A repository without a GitHub owner shows no gutter, and a failed read, such as `gh` signed out, says why in the gutter.
- Continuing a pull request whose branch is already checked out in the clone, such as the default branch, fails with a toast instead of being skipped.
- Enforced by `your open pull requests from another Mac` in `src/lib/shared/repositories/platform/workstreams.test.ts` (listing opens nothing; continuing opens, fast-forwards and restores, and refuses a branch already checked out and a pull request no longer open), `src/main/db/migrations.test.ts`, and `tests/e2e/clone-repository.spec.ts` (nothing in the sidebar after a clone; **Continue here** opens the pull request on its branch; its row then says **Open**).
