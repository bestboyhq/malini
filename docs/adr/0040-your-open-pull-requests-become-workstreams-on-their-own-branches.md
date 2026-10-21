# 0040 - Your open pull requests become workstreams on their own branches

Status: accepted

## Context

ADR 0006 put every workstream on `malini/<id>`, and `addWorktree` refused any other branch.
ADR 0021 followed only the user's open pull requests on `malini/<id>` heads, so a pull request opened outside Malini, on `feat/login`, never reached it.
Connecting a repository also created a workstream and opened its empty chat, whether or not the user had a task for it.
The user asked that connecting a repository open its scratchpad (ADR 0019) and "just sync them up anyway": a repository with work in progress shows that work as workstreams, and a new one shows the scratchpad alone.
The user also found the synced workstreams' names, the raw pull request titles, too long for the sidebar.

## Decision

- Connecting a repository (`connectRepositoryCommand`) records its project with its real default branch (`repositories.create-repository` takes `defaultBranch`), opens `/repositories/:repositoryId`, and runs `repositories.sync-own-pull-requests` at once; it no longer creates a workstream.
- `syncOwnPullRequests` (`src/lib/shared/repositories/platform/own-pull-requests.service.ts`) keeps every open pull request from `gh pr list --author @me --state open` whose head is in the same repository and is a valid branch name, on any branch.
- A `malini/<valid id>` head keeps that id, so it is the same workstream on every Mac, as in ADR 0021.
- Any other head gets the id `pr-<24 hex of sha256(project id, branch)>`, so the same branch maps to the same workstream on every sync, and `deleted_workstreams` keeps a deleted one deleted without a schema change.
- A head whose branch already exists in the private clone, such as the default branch, is skipped.
- The workstream is a worktree on the pull request's own branch: `createWorkstream` takes `branch`, and `addWorktree` refuses only an invalid branch name (`validateBranch`).
- Every guard that compared a checkout's branch with `malini/<id>` compares it with the workstream's recorded branch instead: commit, push, pull the base, count behind, restart on base and abort in `src/main/git/remote.ts`, saving work before teardown, restore, and the sync's fast-forward.
- The name-chats job names an adopted workstream from its pull request's title, through `ChatPlatform.nameWorkstream` injected as `nameWorkstream`; without Claude it falls back to the title without its Conventional Commit prefix, and `freeWorkstreamName` adds a suffix when the name is taken.
- The first prompt names a workstream only while it still has its generated adjective-noun name (`workstreamAwaitsName`, `isGeneratedWorkstreamName`), so it never renames a synced one.
- A sync asked for while one runs queues one more run after it, so a repository connected mid-sync is not missed until the next 5-minute poll.
- Everything else in ADR 0006 still holds: one private clone per repository with hooks disabled, worktrees under `<app data>/workstreams/<id>`, `.malini/` left out of commits, and Malini, never the agent, commits, pushes and opens pull requests.

## Consequences

- A repository with work in progress opens with that work in the sidebar, each workstream on its real branch, and pushing from Malini pushes to that branch on GitHub.
- A new repository opens on an empty scratchpad, with no throwaway worktree or dependency install.
- Malini now commits and pushes to branches the user created outside it; a push still merges GitHub's new commits in rather than overwriting them, and teardown deletes only the local branch in its private clone.
- Restarting on base after a merge deletes the merged head on GitHub, as GitHub's own option does, for any branch.
- The orphan-branch sweep still looks only under `malini/`, so a local pull request branch left behind by a failed teardown stays in the private clone until a later teardown removes it.
- Each adopted workstream costs a worktree and a dependency install, so a user with many open pull requests gets many workstreams.
- An adopted pull request is kept current like every workstream: once its pull request is read behind its base or not mergeable, the merge queue runs **Update from main**, which merges the base, resolves conflicts with Claude and pushes, right after the repository is connected.
  The user chose this over a sync-specific exception: whether that job runs is the job's concern, not the sync's.
- Enforced by `following your own pull requests from another Mac` in `src/lib/shared/repositories/platform/workstreams.test.ts` (any-branch adoption, naming and its fallback, committing on the recorded branch, the default-branch skip, delete staying deleted), `t6` in `src/main/git/worktrees.test.ts`, the branch-mismatch tests in `src/main/git/remote.test.ts`, `names the chat but keeps a workstream name that was not generated` in `src/lib/chat/platform/agent/commands.test.ts`, `isGeneratedWorkstreamName` in `workstream-names.test.ts`, and `tests/e2e/clone-repository.spec.ts`.
