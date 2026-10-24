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
It refuses `git checkout`, `git switch` and `git worktree` too, and points the agent at a new workstream instead.
Agents write code, and Malini writes the history: it commits, pushes, and opens the pull request when you ask it to.

## The sidebar

- Lines added and removed, unread marks, queued prompts, and pull request status on every workstream.
- A repository shows while it has open workstreams, and while you have it open.
  Open any other from the repository list to start its first workstream.
- Every workstream has its own row under its repository.
- Two or more repositories from one owner fold into a folder named for the owner.
  Click the owner to fold or unfold it, and Malini remembers.
  The repository list groups them the same way, one line per repository, and folding an owner in either place folds it in both.
  A search opens every owner it matches.
- **Settings → Appearance → Sidebar density** picks **Comfortable** or **Compact** rows.
- Drag to reorder, or use **⌥↑** and **⌥↓**.
  An owner's folder moves as one.
- Hide a repository and keep its workstreams.
  Clone or open it again and it comes back.
- **Recently archived**, at the bottom of the sidebar, lists archived workstreams, newest first.
  Drag its top edge to make it taller, or click **Show all**.
  Click one to restore it, or open the pull request it merged.
  Archiving stops the commands its agents left running in the background.
- Connect another repository from the button at the bottom of the sidebar, by right-clicking an empty part of the sidebar, from the **File** menu, or from Malini's icon in the menu bar.
  **Open folder…** connects a folder on your Mac, and **Clone repository…** clones one from GitHub.
- **File → New Workstream** (**⌘N**) starts a workstream in the repository you're in, and **File → New Chat** (**⌘T**) opens a chat in the workstream you're in.
- Open a workstream in your editor or reveal it in Finder.
- Open a repository on GitHub from its right-click menu, the repository list, or its page.
- Each workstream holds many chats, as tabs, named for you.
  The first chat's name names the workstream too.
  A shimmer writes each name in as it arrives: on the chat tab, on the sidebar row, and on the commands an agent leaves running.
  **⌘W** closes one and **⌘K** finds the ones that don't fit.
  A closed tab folds away, and the tabs after it slide into its place.
- Files open as tabs beside the chats, from the **Files** tree or a file the chat names, and you edit them right there.
  Malini saves as you type, so there is nothing to press, and only a save that fails says so, under the file.
  The first edit keeps a preview tab, and the tab marks what your branch added and removed.
  A change the agent makes to an open file shows in its tab, unless you have typed something it has not saved yet.

A repository opens on its **scratchpad**, where you keep ideas.
Any paragraph moves into a new workstream.

## Your open pull requests

Add a repository, and every pull request you have open in it opens as a workstream on its own branch, so you pick up where you left off.
Claude names each one from its title.
Malini checks again every 5 minutes, on every Mac you use, and skips pull requests from forks.
A workstream you delete stays deleted.
Like every workstream, each one is kept current: a pull request that falls behind its base or conflicts gets **Update from main**.
Settings → Jobs picks when that happens: as main moves, when you open the workstream, or only when you merge.

## From prompt to merged

- **Draft** opens a draft pull request.
  The agent writes the commit subject and the pull request title in your repository's convention, and Malini commits, pushes, and opens it.
- **Merge** queues it: push, mark ready, update from main, wait for checks and review, and merge with the repository's own merge method.
  The workstream archives itself when it lands and moves to **Recently archived**.
- **A dev server doesn't hold it.** The queue merges past a command the agent left running in the background, and archiving stops it.
- **While it waits, it works.** The queue runs the **Fix checks**, **Update from main**, **Resolve conflicts**, and **Address review** [jobs](/malini/docs/jobs.md) as needed, then replies to and resolves the review threads it fixed.
- **Blockers clear themselves.** When main moves or a reviewer requests changes, **Update from main** or **Address review** runs on its own, and the top bar says **Clearing blockers**.
  Each review is addressed once, then Malini waits for the reviewer.
- **Needs you, only when it does.** A reviewer asks something only you can answer, a fix gave up, GitHub blocks the merge, or your GitHub sign-in expired.
  The top bar names the reason, and the merge picks up again on its own once it is resolved.
- **Exactly the commit that passed.** Malini merges with `--match-head-commit`.
- **Closed on GitHub?** **Reopen** brings the same pull request back, with its number and reviews, or **Archive** puts the workstream away.

Your open `malini/*` pull requests open as workstreams on every Mac you use Malini on.
