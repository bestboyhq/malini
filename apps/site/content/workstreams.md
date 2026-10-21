---
title: Workstreams
description: A workstream is one task in Malini - its own git worktree, branch, and chats - and the merge queue that takes it from Draft to a merged pull request.
---

## One worktree per task

The **+** next to a repository starts a workstream.
Every workstream is its own **git worktree** on a branch named `malini/<id>`, branched from a private clone of the repository.
A workstream opened from one of your pull requests keeps that pull request's branch.
Malini installs dependencies for you from the lockfile: pnpm, npm, yarn, or bun.

Two agents never edit one checkout, so they never clobber each other.

## Malini owns git

The agent bridge refuses to commit, push, rebase, reset, or run `gh pr create`.
Agents write code, and Malini writes the history: it commits, pushes, and opens the pull request when you ask it to.

## The sidebar

- Lines added and removed, unread marks, queued prompts, and pull request status on every workstream.
- Drag to reorder, or use **⌥↑** and **⌥↓**.
- Hide a repository and keep its workstreams.
  Clone or open it again and it comes back.
- **Recently archived**, at the bottom of the sidebar, lists archived workstreams, newest first.
  Drag its top edge to make it taller, or click **Show all**.
  Click one to restore it, or open the pull request it merged.
  Archiving stops the commands its agents left running in the background.
- Connect another repository from the button at the bottom of the sidebar.
- Open a workstream in your editor or reveal it in Finder.
- Open a repository on GitHub from its right-click menu, the repository list, or its page.
- Each workstream holds many chats, as tabs, named for you.
  The first chat's name names the workstream too.
  A shimmer writes each name in as it arrives: on the chat tab, on the sidebar row, and on the commands an agent leaves running.
  **⌘W** closes one and **⌘K** finds the ones that don't fit.
  A closed tab folds away, and the tabs after it slide into its place.

A repository opens on its **scratchpad**, where you keep ideas.
Any paragraph moves into a new workstream.

## Your open pull requests

Add a repository, and every pull request you have open in it opens as a workstream on its own branch, so you pick up where you left off.
Claude names each one from its title.
Malini checks again every 5 minutes, on every Mac you use, and skips pull requests from forks.
A workstream you delete stays deleted.
Like every workstream, each one is kept current: a pull request that falls behind its base or conflicts gets **Update from main**.

## From prompt to merged

- **Draft** opens a draft pull request.
  The agent writes the commit subject and the pull request title in your repository's convention, and Malini commits, pushes, and opens it.
- **Merge** queues it: push, mark ready, update from main, wait for checks and review, and merge with the repository's own merge method.
  The workstream archives itself when it lands and moves to **Recently archived**.
- **A dev server doesn't hold it.** The queue merges past a command the agent left running in the background, and archiving stops it.
- **While it waits, it works.** The queue runs the **Fix checks**, **Update from main**, and **Address review** [jobs](/malini/docs/jobs.md) as needed, then replies to and resolves the review threads it fixed.
- **Blockers clear themselves.** When main moves or a reviewer requests changes, **Update from main** or **Address review** runs on its own, and the top bar says **Clearing blockers**.
  Each review is addressed once, then Malini waits for the reviewer.
- **Needs you, only when it does.** A reviewer asks something only you can answer, a fix gave up, GitHub blocks the merge, or your GitHub sign-in expired.
  The top bar names the reason, and the merge picks up again on its own once it is resolved.
- **Exactly the commit that passed.** Malini merges with `--match-head-commit`.
- **Closed on GitHub?** **Reopen** brings the same pull request back, with its number and reviews, or **Archive** puts the workstream away.

Your open `malini/*` pull requests open as workstreams on every Mac you use Malini on.
