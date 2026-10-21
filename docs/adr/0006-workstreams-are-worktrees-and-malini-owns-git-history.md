# 0006 - Workstreams are worktrees of a private clone, and Malini owns their git history

Status: superseded by 0041

## Context

Agents running in parallel need working trees of their own.
In the user's checkout they would collide with the user's edits and with each other.
An agent that runs git freely can commit, rebase, reset or push in ways the user cannot follow or undo.

## Decision

- Connecting a repository clones it once into `<app data>/repositories/<project id>/base`, with git hooks disabled.
- Each workstream is a `git worktree` of that clone at `<app data>/workstreams/<workstream id>` on the branch `malini/<workstream id>`.
- Files Malini manages in a worktree live under `.malini/` (agent attachments, sandbox scratch) and are left out of diffs and commits.
- Agents leave their changes in the working tree and name the commit in their last message.
  Malini commits, pushes, branches and opens the pull request.

## Consequences

- Any number of workstreams run side by side without touching the user's checkout or each other.
- Each worktree installs its own dependencies (`provisioning.service.ts`), which costs disk and time per workstream.
- Malini has to reconcile worktrees with the database on every boot and tear them down itself (`teardown.service.ts`).
- Enforced by `addWorktree` in `src/main/git/worktrees.ts`, which refuses a branch outside `malini/`, and by `MALINI_OWNED_GIT_COMMANDS` in `packages/agent-bridge/src/claude/permissions.ts`, which refuses an agent's commit, push, checkout, switch, reset, clean, rebase, merge, stash writes and `gh pr create`.
