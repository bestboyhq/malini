# 0182 - Malini lands the brain on main without a pull request

Status: accepted

## Context

Every workstream reaches `main` through a pull request that Malini opens and merges, and nothing pushed to `main` before.
The brain (0180) is a private repository only you read, with no checks and no reviewer, written by a capture every archive and a rewrite every week: a pull request each time would be noise to merge by hand.
The planning brief said "A brain probably pushes straight to main with no pull request", and the user asked that Malini, not the agent, commit and push it.
The agent that writes the notes reaches no internet (0180), so it could not push anyway.
A brain lands from more than one place, such as two Macs, and from a network that may be gone.

## Decision

- **Malini commits.**
  After a capture, `commitPaths` (`src/main/git/remote.ts`) commits `log/` as "Capture 2 chats", and after **Write the notes** succeeds it puts `log/` back and commits the rest as "Rewrite notes", with hooks off and `malini-agent[bot]` as the author only when git and GitHub name nobody.
  A capture with nothing new commits nothing.
- **Straight to main.**
  `pushHeadToGithubMain` pushes the Brain workstream's `HEAD` to `refs/heads/main` with the GitHub CLI's credentials, the way a workstream branch is pushed, and a brain on this Mac pushes into its own folder.
  It runs after every landing, and every five minutes while a commit waits.
- **Private, every time.**
  Before every push to GitHub, Malini reads the repository's `private` flag again and pushes nothing to a repository that turned public: the problem reads "<owner>/brain is public. Malini keeps a brain only in a private repository."
- **One rebase, then you.**
  When GitHub has commits this Mac lacks, Malini fetches `main`, rebases onto it once and pushes again.
  A clash aborts the rebase, keeps the brain's own commits, and the problem reads "GitHub has brain changes this Mac lacks, and they clash with its own. Pull them into the Brain workstream, then retry."
- **A denied push waits for you** with 0162's reason, such as "`szymeo` can't push to szymeo/brain. Ask its owners for write access, then retry."
- **Offline waits quietly.**
  A push that cannot reach GitHub sets no problem: the commits wait, `BrainStatus.unpushed` counts them, and the next landing or the five-minute retry pushes them.
- **You can stop it.**
  **Sync with GitHub** off (`brain.set-sync`) keeps new commits on this Mac until you turn it back on, which pushes what waits and is also **Retry**.
  `brain:changed` carries every change of the status, and the Brain page and Settings, Brain show it.

## Consequences

- The brain on GitHub is never more than one landing and five minutes behind this Mac, with no pull request to merge.
- Malini now pushes to a `main`, but only of the repository it made or adopted as the brain, and only while that repository is private.
- A clash between two Macs waits for you instead of losing either side.
- Enforced by `src/lib/brain/platform/brain-git.test.ts` (a rebase over notes landed elsewhere, then a push; a clash keeps its own commit and leaves no rebase behind) and `tests/e2e/brain.spec.ts` (an archived chat lands on the fake GitHub's `main`, and a public repository is refused).
