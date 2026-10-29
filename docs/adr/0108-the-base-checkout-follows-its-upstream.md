# 0108 - The base checkout follows its upstream

Status: accepted

## Context

0098 fills a workstream by cloning the base checkout's files copy-on-write, but that checkout stayed at the commit it was cloned at, as the `ponytail:` note in `worktrees.ts` said.
Every file that changed upstream since then was written fresh into every new workstream.
On the user's Mac the `malini` base checkout sat at a commit from October 20, 99 commits behind `origin/main`.
The user's friend runs Malini on PostHog, 8.5 GB on GitHub with many commits a day, where that gap grows fastest, and was told not to use Malini for it because of disk.
The user asked to close the gap.

## Decision

- `addWorktree` (`src/main/git/worktrees.ts`) runs `advanceBaseCheckout` inside the project lock, before `git worktree add`.
- It reads the upstream of the base checkout's branch with `git rev-parse --symbolic-full-name @{upstream}`, and does nothing when there is none, such as the lead space or a detached checkout.
- It moves the branch with `fastForwardCheckout` (`src/main/git/remote.ts`), a `git merge --ff-only` with hooks off, to the remote ref Malini last fetched, without fetching again.
- When the branch has diverged from its upstream or the merge fails, it logs a warning and the workstream starts anyway, writing the files the base checkout lacks, as before.
- A restore still fills its checkout from the base checkout as it is, since it starts from an old commit.

## Consequences

- Files that changed upstream are written once into the base checkout, and every later workstream clones them instead of writing its own copy.
- The first workstream after a long gap waits for that write, as it waited to write the same files into its own checkout.
- The base checkout's default branch now moves with `origin`, so nothing may commit to it; Malini commits only on workstream branches (0006, 0041).
- A workstream on another branch, such as an adopted pull request or a tag, still writes the files that differ from the default branch.
- Enforced by `fast-forwards the base checkout to its upstream so the next workstream clones current files` in `src/main/git/worktrees.test.ts`.
