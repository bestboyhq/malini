---
title: Workstreams
description: A workstream is one task in Malini - its own git worktree, branch, and chats - that Malini takes from Draft to a merged pull request.
---

## One worktree per task

The **+** next to a repository starts a workstream.
Every workstream is its own **git worktree** on a branch named `malini/<id>`, branched from a private clone of the repository.
A workstream opened from one of your pull requests keeps that pull request's branch.
Malini installs dependencies for you from the lockfile: pnpm, npm, yarn, or bun.

Two agents never edit one checkout, so they never clobber each other.

## Disk space

Workstreams share disk space, so you can keep as many as you like.

- **Checkouts are copy-on-write.** A new or restored workstream clones its files from the repository's clone, so a file takes no extra space until an agent changes it.
- **Dependencies are shared.** With npm or yarn, a workstream copies `node_modules` the same way from another workstream with the same lockfile, instead of installing again.
  pnpm and bun share packages through their own store.
- **One clone per repository.** A repository you open from a folder on your Mac is cloned from that folder and shares its git objects, then fetches the rest from its remote.
  A GitHub repository over 1 GB is cloned without the history of its files, and git fetches an old version of a file the first time something reads it.
- **Archives stay small.** Archiving keeps the commits, uncommitted changes, chats, attachments, every image or recording a chat showed, and the text files up to 10 MB in the `.context` folder, so an agent can still learn from the work.
  It drops the rest of `.context`, such as other screenshots, downloads, builds and dependency folders.
- **Old chats are packed.** Closing a chat or archiving its workstream compresses the chat's tool calls, their output and the agent's thinking, most of what a chat holds, to about a fifth of their size, and Malini gives the freed space back to the disk.
  The chat reads the same as before, and restoring the workstream unpacks it.
- **Malini checks first.** It starts no workstream, clone or restore when the disk has less than 2 GB free, and says how much is free.

## Malini owns git

The agent bridge refuses to commit, push, rebase, reset, or run `gh pr create`.
It refuses `git checkout`, `git switch` and `git worktree` too, and points the agent at a new workstream instead.
Agents write code, and Malini writes the history: it commits, pushes, and opens the pull request when you ask it to.

## The sidebar

- The focus strip at the top narrows the sidebar.
  **All** shows everything, and **+** pins an organization or a repository beside it.
  Click a pin to see only its chats and workstreams, and right-click it to unpin it.
  A dot on a pin means something in it needs you.
- The sliders button beside it groups and sorts the sidebar, and Malini remembers.
  Its panel opens beside the sidebar, so the rows stay in view while you change them.
  **Grouping** picks **Organization**, an owner row above its repositories, **Repository**, every repository on its own with every chat above them, **Status** or **Day**.
  **Status** splits your work into **Needs you**, **In progress**, **In review**, **Idle**, **Stale** and **Merged**.
  Stale work has had no agent run for a week.
  **Day** splits it into **Today**, **Yesterday** and **Older**, by when an agent last ran in it or you started a chat there.
  Under Status or Day, **Sub-grouping** lists each section by **Repository**, by **Organization**, or flat with **No grouping**, where each row names its repository.
  Click a section to fold it.
  **Ordering** picks **Manual**, the order you drag, **Last active**, **Created**, newest first, or **Name**.
  A repository or an owner sorts by the newest work in it.
  Rows drag only in Manual order, grouped by organization or repository.
  **Reset** goes back to Organization and Manual.
- **New chat** starts a [chat above your repositories](/malini/docs/chat.md#chats-above-repositories), at Home.
  The **+** on an owner's row starts one for that organization.
  Grouped by Status or Day with a pin open, **New chat** stays on top: on an organization's pin it starts a chat for that organization, and on a repository's pin a workstream in that repository.
- By organization, every repository sits under a row named for its owner, below that owner's chats.
  Click the owner to fold or unfold it, and Malini remembers.
  The repository list groups them the same way, one line per repository, and folding an owner in either place folds it in both.
  A search opens every owner it matches.
- Every repository you connect shows, with or without workstreams, until you hide it.
  A clock and a count on its row say how many wait saved for later.
- A workstream a chat at Home or in an organization started sits under that chat's row, with the name of its repository, and so does every workstream those workstreams start, one level deep: a workstream never holds another.
  A workstream started from a workstream of a repository, with no such chat above it, sits under its repository.
  The chevron on the chat's row folds them, and Malini remembers.
  Under a pin that leaves the chat out, or in a Status or Day section the chat is not in, the workstream sits under its repository.
- A row that started workstreams shows a dot for each: merged, needs you, failed, working, or waiting, then a dot for each archived one, filled when it merged and hollow when it did not.
  Hover the row to list them with where each stands.
  On that chat's page, the top right lists them under the count.
- Lines added and removed, unread marks, queued prompts, and pull request status on every workstream.
  A row's icon turns amber when its agent waits on an answer or an approval, and red when its run failed.
  A workstream a chat started stays calm, and [the chat's row](/malini/docs/chat.md#chats-above-repositories) lights up for it instead.
- **Settings → Appearance → Sidebar density** picks **Comfortable** or **Compact** rows.
- Sorted by **Manual**, drag to reorder, or use **⌥↑** and **⌥↓**.
  An owner moves with everything under it.
- **Hide** in a repository's right-click menu takes it out of the sidebar and keeps its workstreams.
  **Unhide** brings it back from **Hidden** in the repository list, and so does cloning or opening it again.
- **Recently archived**, at the bottom of the sidebar, lists archived workstreams, newest first.
  Drag its top edge to make it taller, or click **Show all**.
  Click one to restore it, or open the pull request it merged.
  Archiving stops everything still running from its folder: the commands its agents left in the background, what those commands started and let go, and its Docker Compose containers.
  A command you run in your own terminal keeps running.
  When Malini starts, it stops whatever is still running from the folder of a workstream that is no longer live.
- The clock beside a workstream's archive button saves it for later.
  Like archiving, it keeps its commits, uncommitted changes and chats, and frees its checkout, but it keeps all of `.context` until you archive it.
  It waits in its repository's scratchpad instead of **Recently archived**.
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
- A Markdown file opens **Raw**, its text to edit, and **Rich** beside it renders it for reading.
  Switching keeps your place, the tab remembers which one you picked, and a file opened at a line opens **Raw**.
  Its links open their files in tabs, and its images show from the worktree.

A repository opens on its **scratchpad**, where you keep ideas.
Any paragraph moves into a new workstream.
Workstreams you saved for later wait above the ideas, newest first.
Click one to resume it where you left off, or archive it to move it to **Recently archived**.

## Your open pull requests

Add a repository, and every pull request you have open in it opens as a workstream on its own branch, so you pick up where you left off.
Claude names each one from its title.
Malini checks again every 5 minutes, on every Mac you use, and skips pull requests from forks.
A workstream you delete stays deleted.
Like every workstream, each one stays on its own commits while main moves, and merging it brings it up to date with its base.

## From prompt to merged

- **Draft** opens a draft pull request.
  The agent writes the commit subject and the pull request title in your repository's convention, and Malini commits, pushes, and opens it.
  A turn without a commit subject commits under the pull request title or the files it changed, and a pull request without a title takes the chat's title or the files changed, never your prompt or the agent's reply.
- **Merge** queues it: push, mark ready, update from main, wait for checks and review, and merge with the repository's own merge method.
  The workstream archives itself when it lands and moves to **Recently archived**.
  **Keep**, beside **Cancel** while the merge is queued, leaves it open on **Merged** instead, with **Archive** and **Continue**.
- **It runs on events.** **Draft**, **Merge**, **Cancel** and **Keep** each log a **Button clicked**, and the [Reconciler](/malini/docs/jobs.md#reconciler)'s **Shipping** rule takes the workstream from there.
  It moves only when Malini logs something, such as a turn or a job that ends, a change on GitHub, or a wait that ends, and it picks up where it left off after a restart.
  A chat or a job ships with the **Open draft** or **Merge** job, and that job finishing moves the workstream on.
- **A dev server doesn't hold it.** Malini merges past a command the agent left running in the background, and archiving stops it.
- **While it waits, it works.** Malini merges main into the branch when GitHub says it is behind or conflicts, and runs the **Fix checks**, **Resolve conflicts**, and **Address review** [jobs](/malini/docs/jobs.md) as needed, then replies to and resolves the review threads it fixed.
- **What GitHub says is on the record.** Malini reads the pull request on GitHub each time the pull request bar does, and on its own only while shipping waits on GitHub: every 15 seconds for a queued merge, every 45 seconds while its checks run, and every 2 minutes while it waits for a review or for you, never while an agent or a job works.
  Each read that finds something new is a `pull-requests:pull-request-changed` event: its checks, its review with each change request and open thread, how far it is behind its base, whether it conflicts, and whether you may merge it.
  Every job Malini starts for it names that read as its cause, so the [Explorer](/malini/docs/jobs.md#explorer) traces a **Fix checks** back to the prompt behind the change it fixes.
- **Blockers clear themselves.** When a reviewer requests changes, **Address review** runs on its own, and the top bar says **Clearing blockers**.
  Each review is addressed once, then Malini waits for the reviewer, and a new review that requests changes again is addressed in turn.
- **Main moving starts nothing.** A workstream behind main stays as it is while you work, and Malini merges main into it only once you merge it.
- **Errors are retried.** After a step fails, Malini tries again in 30 seconds, then waits twice as long each time, up to 10 minutes, and the top bar says **Retrying after an error**.
- **Offline or GitHub down, it says which, on every page.** The top right corner says **Offline** as soon as your Mac loses its connection, and Malini reads GitHub again the moment it is back.
  Online, it says **GitHub is not responding** when GitHub doesn't answer, **GitHub is down** when it answers with a server error, or **GitHub rate limit reached** when it limits your account, and **Status** opens githubstatus.com.
  It clears on its own once GitHub answers again: Malini asks every 30 seconds while it waits.
- **Needs you, only when it does.** A reviewer asks something only you can answer, a fix gave up, GitHub blocks the merge, your GitHub sign-in expired, or a git operation stopped part-way.
  The top bar names the reason, and once it is resolved, the merge picks up again on its own: when GitHub shows a change, its branch moves, a turn in the chat ends, a git operation you aborted or finished leaves the checkout, or a retry comes due.
  There is no **Retry** in the top bar, because a retry without the details does nothing new.
  When a fix gave up, **Open job** shows that job's chat and why the merge stopped, with **Retry merge**, which queues it again.
- **A limit doesn't stop it.** A fix job whose turn hits a usage limit or an outage [pauses](/malini/docs/chat.md#limits-and-outages) and keeps the merge waiting, without spending an attempt.
- **Exactly the commit that passed.** Malini merges with `--match-head-commit`.
- **Closed on GitHub?** **Reopen** brings the same pull request back, with its number and reviews, or **Archive** puts the workstream away.

Your open `malini/*` pull requests open as workstreams on every Mac you use Malini on.
