# 0021 - Your open pull requests follow you across Macs

Status: accepted

## Context

A user drafts a pull request on one Mac and wants the same workstream on another Mac without setting it up again.
Malini already pushes each workstream's branch `malini/<id>` to GitHub when it opens the draft (ADR 0006), and the id is random, so the branch names one workstream on every Mac.
There is no backend to sync through (ADR 0001), and chat transcripts, checkpoints and the scratchpad stay in the local SQLite file.
The user ruled out syncing the conversation, and left any progress note to a job of their own rather than a built-in feature.

## Decision

- GitHub is the only thing two Macs share: the branch and its pull request, read through `gh`.
- `followOwnPullRequestsHook` (`src/lib/shared/repositories/application/hooks/follow-own-pull-requests.hook.ts`) calls `repositories.sync-own-pull-requests` when the workstreams layout mounts and every 5 minutes.
- `syncOwnPullRequests` (`src/lib/shared/repositories/platform/own-pull-requests.service.ts`) runs `gh pr list --author @me --state open` in each repository's base clone and keeps pull requests from the same repository whose head is `malini/<valid id>`.
- Only repositories already cloned on this Mac take part, and a hidden repository (`hidden_repositories`) is skipped entirely; Malini never clones a repository to follow a pull request.
- A pull request with no local workstream is fetched and opened as a worktree on its own branch, named after its title without the Conventional Commit prefix, and the renderer installs its dependencies.
- A pull request whose active workstream is behind GitHub is fast-forwarded, only when the checkout move lease is free and the merge is a fast-forward.
- A workstream deleted on this Mac is recorded in `deleted_workstreams` and never reopened; an archived one stays archived.
- Nothing else crosses machines: no transcript, no handoff note, no work that has not been pushed.

## Consequences

- Opening Malini on a second Mac shows every open pull request the user drafted elsewhere, ready to continue or merge.
- A workstream moves between Macs only once Malini has pushed it, which happens when the user opens the draft.
- Two Macs working the same branch can diverge; Malini never merges or forces on this path, and the next push merges GitHub's commits in or asks the user (`pushWorkstreamBranch`).
- Workstreams deleted before `deleted_workstreams` existed come back once if their pull request is still open.
- The test `following your own pull requests from another Mac` in `src/lib/shared/repositories/platform/workstreams.test.ts` fails when adoption, fast-forward, the fork filter, the delete record or the hidden-repository skip breaks.
