# 0279 - Every commit carries your GitHub noreply address

Status: accepted

## Context

0169 had Malini commit as the git identity the checkout already has, and take the GitHub noreply address only when git had no `user.email`.
A public repository worked on only through Malini workstreams then published eleven commits that carried the user's private email address, because their global git config named it.
The commits that leaked were not all made by `commitWorktreeChanges`: a commit made in a terminal, by a tool the agent runs, or by Xcode reads the clone's git config and never passes through `commitConfig`.
The user: "we should probably just use no reply address because like commits are commits but if someone really wants to expose their address they'll just put it in pkg.json".
They also asked that Malini figure this out "out of the box, without bothering our users", so no setting, prompt or repository hook asks for it.

## Decision

- `commitConfig` in `apps/malini/src/main/git/remote.ts` passes `user.name` and `user.email` from `githubCommitIdentity()` to every commit, rebase and merge Malini makes, whatever git's own config says.
  The identity is the GitHub name, or the login, and `<id>+<login>@users.noreply.github.com`, from `gh api user`.
- `githubCommitIdentity()` keeps the last identity it read for 10 minutes, waits at most 15 seconds for `gh`, and keeps the last one it read when `gh` fails.
- With no identity read yet, a commit takes the fallback its caller names (`AGENT_IDENTITY` for the brain), else git's own identity, as before.
- `addWorktree` in `apps/malini/src/main/git/worktrees.ts` writes the same `user.name` and `user.email` into the base clone's local git config, inside the project lock, before it adds the worktree.
  Every worktree of that clone shares the config, so the agent's commands, a terminal and any app that commits there carry the noreply address too.
  A failed write logs a warning and never stops the workstream.
- Before each push to GitHub, `pushWorkstreamBranch` and `pushHeadToGithubMain` call `replaceYourEmailBeforePush`, which works backwards over the commits no remote-tracking ref holds (`git rev-list HEAD --not --remotes`).
  An author or committer whose email is one of yours takes the noreply identity, and every later commit takes its new parents; dates, messages and trees stay, so the worktree and index never change.
  Your emails are every `user.email`, `author.email` and `committer.email` git config gives the checkout, and the `<user>@<host>` git makes up when none is set; a noreply address is never one of them.
  The new commits are written with `git hash-object`, a rewritten commit drops its `gpgsig`, and `git update-ref HEAD <new> <old>` moves the branch only if nothing committed meanwhile.
  The user asked for it: "if someone has commits that are local and already contain their email address, we should also make sure that they are cleaned before pushing".
- With such commits and no GitHub account read yet, the push stops with "Malini could not read your GitHub account, so it did not push commits that carry your email address. Push again once GitHub answers."
- `apps/malini/vitest.config.ts` sets `MALINI_GH_PATH` to `/usr/bin:/bin` for the main project, so unit tests never ask the developer's own `gh` who they are.
- The rest of 0169 stays: the `Co-authored-by: malini-agent[bot]` trailer, **Sign contributions** and the Cooked with Malini footer.

## Consequences

- A public repository never gets the email address in the user's git config from a Malini push, whoever made the commit: Malini, the agent, a terminal or Xcode, before or after this decision.
- A user who wants their own address on their commits cannot have it in a Malini clone; they can still publish it elsewhere, such as `package.json`.
- A clone whose workstreams all predate this decision keeps git's own identity for commits Malini does not make, until its next workstream starts; the push still replaces it.
- A commit already on GitHub keeps its address: replacing it needs a force push, which Malini does not make.
- A commit that no remote-tracking ref holds but GitHub already has, such as one pushed from another clone, gets a new hash, and the push merges GitHub's copy back.
- An email the checkout's git config no longer names, such as an old address, is not replaced.
- A recorded run's short hash, quoted in "Addressed in", can name the commit from before the push.
- A push that replaces thousands of commits takes two git calls for each.
- `remote.test.ts` fails when a workstream commit's author or committer is not the noreply address of the `gh` account while git config names another, and when a push leaves your email on an unpushed commit, rewrites a pushed commit or a colleague's authorship, changes a date or a tree, or keeps a signature it broke; `worktrees.test.ts` t10 fails when a new workstream's clone does not commit as that address; `open-draft.spec.ts` fails when the pushed commit carries the address in git config instead of the noreply one.
