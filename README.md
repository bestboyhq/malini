<p align="center">
  <img src="apps/malini/build/icon.png" width="128" height="128" alt="malini app icon">
</p>

<h1 align="center">malini</h1>

<p align="center">
  <b>You had one job. Now you can have hundreds.</b><br>
  Every task gets its own git worktree and its own Claude Code, side by side in one window.<br>
  Free and open source, for the Mac.
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg"><img src="https://img.shields.io/badge/Download_for_macOS-000?style=for-the-badge&logo=apple&logoColor=white" alt="Download for macOS" height="40"></a>
</p>

<p align="center">
  <a href="https://github.com/bestboyhq/malini/releases/latest"><img src="https://img.shields.io/github/v/release/bestboyhq/malini?label=release&color=5e5ce6" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-1c1c1e?logo=apple" alt="macOS 13 or later">
  <img src="https://img.shields.io/badge/Apple_silicon-native-1c1c1e" alt="Native on Apple silicon">
  <img src="https://img.shields.io/badge/agent-your_Claude_Code-1c1c1e" alt="Runs your own Claude Code">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1c1c1e" alt="AGPL-3.0 license"></a>
</p>

<p align="center">
  <img src=".github/readme/hero.webp" width="100%" alt="The malini window: six workstreams across malini, grip and tony in the sidebar, a finished malini chat that read the code, edited package.json and docs/packaging.md, ran the new script, and ended with a commit subject and a pull request title, and 2 files changed with Draft and Merge in the top bar.">
</p>

<p align="center">
  <b>1</b> worktree per task&nbsp;&nbsp;·&nbsp;&nbsp;<b>0</b> commits by agents&nbsp;&nbsp;·&nbsp;&nbsp;<b>3</b> jobs to get your PR merged&nbsp;&nbsp;·&nbsp;&nbsp;<b>0</b> malini servers
</p>

---

If Cursor, Codex, Conductor, and Claude Code had a baby, it would probably look a lot like malini.
We use and admire all four, and malini borrows openly from each of them.
From Cursor, an app built around working with an agent rather than next to one.
From Codex, handing off a task and coming back to a finished change.
From Conductor, giving every agent a workspace of its own.
And from Claude Code, the agent itself: malini runs your own `claude`, signed in with your own account.

malini puts those ideas together in one window on your Mac.
Every task gets a workstream: a git worktree on its own branch, its own Claude Code, and as many chats as you need.
Start one, or start a hundred, and keep each of them moving with a prompt queue.
When the work is ready, malini commits it, opens the pull request, and helps it get merged, so you can spend your time on the parts that need you.

## Why malini

- **Parallel by default.** Every workstream is a separate git worktree on its own branch, so agents never share a checkout.
- **Your Claude Code, your plan.** malini drives the `claude` you already use, signed in with your own account, through the Claude Agent SDK.
  No API key to paste and no second subscription.
- **Agents write code. malini owns git.** Agents can't commit, push, rebase, or open pull requests.
  malini makes every commit, as `malini-agent[bot]` in your repository's commit convention, and pushes when you ask.
- **From prompt to merged.** Press Merge, and malini's merge queue updates from main, fixes failing checks, answers bot reviews, and merges once GitHub allows.
- **Local first.** No account and no malini server.
  Your code goes to Anthropic through your Claude Code and to GitHub through your `gh`, and nowhere else.
- **Free and open source.** No subscription, no seat, no telemetry you can't turn off.

### Made for many agents at once

| The problem                                                              | What malini does                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two agents edit one checkout and clobber each other                      | Every workstream is its own **git worktree** on `malini/<id>`, branched from a private clone of the repository.                                  |
| An agent commits half-done work or opens a pull request you never wanted | The agent bridge **refuses commit, push, rebase, reset, and `gh pr create`**. malini owns the history.                                           |
| A new prompt kills the run in flight                                     | **↵ queues** the prompt after the current run. **⌘↵ steers** it now.                                                                             |
| A run "finishes" while its dev server and subagents still work           | A run **stays open while its background commands and agents run**, and you can stop each one.                                                    |
| One bad turn wrecks the branch                                           | Every run has **Undo**. Edit an earlier message to resend from there, or **fork to a new chat**, even mid-run.                                   |
| You come back to ten agents and can't tell which one needs you           | Every turn ends with a **Your turn** list, unread workstreams are marked, and a chime and a notification tell you a run finished.                |
| The pull request sits red for hours                                      | The merge queue runs **Fix checks**, **Update from main**, and **Address bot review** until it merges, and says **Needs you** only when it must. |
| The merge lands a commit nobody checked                                  | malini merges with `--match-head-commit`, so GitHub merges **exactly the commit that passed**.                                                   |
| Quitting the app halfway through a run loses the work in flight          | Runs that a restart cut short **pick up where they left off** the next time malini opens.                                                        |

## Workstreams, side by side

- **One click per task.** The **+** next to a repository starts a workstream: a fresh worktree, its own branch, and dependencies installed for you from the lockfile (pnpm, npm, yarn, or bun).
- **Many chats per workstream,** as tabs, named for you.
  **⌘W** closes one and **⌘K** finds the ones that don't fit.
- **A sidebar that tells you everything.** Lines added and removed, unread marks, queued prompts, and pull request status on every workstream.
  Drag to reorder, or use **⌥↑** and **⌥↓**.
- **Tidy without losing work.** Hide a repository and keep its workstreams.
  Archive a workstream and restore it later.
- **Your tools, one click away.** Open a workstream in your editor or reveal it in Finder.
- **Any repository.** Clone one from GitHub, with your recent repositories one search away, or open a folder on your Mac.

<p align="center">
  <img src=".github/readme/answers.webp" width="100%" alt="A grip workstream answering how captions, zooms and keystrokes stay in sync after cuts and speed changes, with a file and line reference for each step, next to the other workstreams in the sidebar.">
</p>

<p align="center">
  <sub>Ask about the code and get an answer with file references. Every workstream keeps its own chats.</sub>
</p>

## A chat that keeps up

<p align="center">
  <img src=".github/readme/run-options.webp" width="100%" alt="The Run options menu open over a chat: Plan mode, Agent access with Sandboxed checked, Auto, and Full access, Report with Low, Medium checked, and High, and Model settings.">
</p>

<p align="center">
  <sub>Plan mode, how much the agent may do on its own, and how much it reports back, one menu from the composer.</sub>
</p>

- **Queue or steer.** **↵** queues a prompt after the current run, **⌘↵** interrupts and steers.
  Edit, reorder, or delete what's queued.
- **Plan first.** Plan mode writes the plan, then **Implement plan** starts the work, with a model of its own if you like.
- **Model and effort per prompt.** Fable, Opus, Sonnet, or Haiku, from Low to Max effort.
- **As much rope as you want to give.** **Sandboxed** edits the workstream and runs commands in a sandbox, and asks for anything else.
  **Auto** uses Claude Code's auto mode, and **Full access** never asks.
  Approve once, or always for the chat or the workstream.
- **As much reading as you want to do.** Reports run from a screenshot and one line to the full write-up.
- **Watch it think.** Thinking shows inline, step by step, from the moment the run starts, with a diff for every file the chat changed.
- **Bring context.** **@** mentions a file, and you can attach or paste images and files and link an issue.
- **Know your limits.** The context window breakdown and your plan usage, five-hour and weekly, are one click from the composer, next to MCP server status.
- **Undo, edit, fork.** Every run can be undone.
  Edit an earlier message to resend from there, or fork to a new chat while the agent is still busy.

## From prompt to merged

- **Draft** opens a draft pull request.
  The agent writes the commit subject and the pull request title in your repository's convention, and malini commits, pushes, and opens it.
- **Merge** queues it: push, mark ready, update from main, wait for checks and review, and merge with the repository's own merge method.
  The workstream archives itself when it lands.
- **While it waits, it works.** The queue runs **Fix checks**, **Update from main**, and **Address bot review** as needed, then replies to and resolves the bot threads it fixed.
- **Needs you, only when it does.** A reviewer wants an answer, a fix gave up, GitHub blocks the merge, or your GitHub sign-in expired.
- **The whole pull request in the top bar.** Checks, changes, and review live one click away, and **Continue** keeps working on the latest base once it merges.

## Jobs and routines

<p align="center">
  <img src=".github/readme/jobs.webp" width="100%" alt="The Jobs page: an empty Your jobs section and the three built-in jobs, Fix checks, Update from main, and Address bot review, each with its model, effort, and an Edit and a Reset button.">
</p>

- **A job is agent work you reuse.** A name, instructions, a model, and an effort.
  Run it in this workstream or a new one, and pick what happens when it finishes: nothing, a draft pull request, or a queued merge.
- **The built-in jobs are yours to edit.** Reset brings back the original.
- **Routines chain steps.** Jobs, extension commands, and workflows run in order when you run the routine or when a new workstream is created.
- **Trust is earned.** A routine starts as a draft, becomes a candidate whose every triggered run asks you first, and only then runs unattended.
- **Suggestions from your own habits.** malini notices the prompts you keep repeating and offers to turn them into a job and a routine.
- **A Job center** shows what's running and what just finished.
  Settings decides how many jobs run at once.

## A browser the agent can drive

- **Browser tabs in the inspector,** right next to your files.
- **Pick an element** on the page and it lands in your prompt.
- **The agent browses too.** It opens, clicks, types, screenshots, and navigates, and the tabs it opens show up beside yours.

## Extensions

- **The inspector is built from extensions.** The built-in Repository extension gives you **Files**: changed files with their diffs, the full tree, file tabs, and todos.
- **Panels, commands, settings, and workflows** come from an extension's manifest, and an extension reaches the workstream through [`packages/extension-api`](packages/extension-api).
  The API is MIT licensed, so an extension can use any license.

## Stats

- **What it costs your Mac, right now.** Memory and CPU for malini, its agents, the tools they started, browser tabs, and Docker, one click from the sidebar.
- **What you got done.** Agents running, runs today, your streak, six months of activity, and where you work.
  Counted on this Mac only.

## Private by design

There is no malini account and no malini server.
Your code leaves your Mac only through your own Claude Code, to Anthropic, and your own `gh`, to GitHub.
malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data to PostHog.
Usage data says which features are used and which errors happen, and never contains your code, prompts, paths, or keys.
Turn it off under Settings, Privacy, Share usage data.

Updates download in the background and install when you quit, or right away with **Restart to Update**.

## Install

1. [Download malini](https://github.com/bestboyhq/malini/releases/latest/download/malini-arm64.dmg), open the disk image, and drag malini to Applications.
   Open it from anywhere else, and malini offers to move itself there.
2. Open it.
   Setup checks Claude Code: **Install** runs the official installer in Terminal, and **Sign in** uses your Claude account.
3. Add a repository: clone one from GitHub or open a folder on your Mac.
   Your first workstream is ready.

malini needs macOS 13 or later on Apple silicon, git, and Claude Code.
Cloning from GitHub and pull requests need the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

## Use it

| Key             |                                                        |
| --------------- | ------------------------------------------------------ |
| **↵**           | Send, or queue after the current run                   |
| **⌘↵**          | Steer now, interrupting the run                        |
| **@**           | Mention a file                                         |
| **⌘W**          | Close the chat tab                                     |
| **⌘K**          | Find a chat tab that doesn't fit                       |
| **⌥↑** / **⌥↓** | Move a repository, a workstream, or an inspector panel |

## Under the hood

```
renderer (Svelte 5, sandboxed)
   │  typed contract
   ▼
main process (Node, SQLite)
   ├─ git worktree per workstream
   ├─ agent bridge ──▶ your claude, through the Claude Agent SDK
   ├─ merge queue ───▶ your gh
   └─ extensions, browser tabs, stats
```

- **Electron with a sandboxed Svelte 5 renderer.** Every command and event between the two processes is declared once in a typed contract and checked on both sides.
- **Claude Code runs in its own bridge process,** on Electron's Node, with a generated and versioned protocol.
- **One SQLite file** through `node:sqlite`, migrated by `user_version`.
- **Vertical domain slices:** chat, pull requests, jobs, routines, extensions, browser, and stats, each seen by the others only through its API file.
- **Every decision written down.** [`docs/adr/`](docs/adr) says why malini is built the way it is.

## Build from source

You need macOS on Apple silicon and Node 24.

```sh
git clone https://github.com/bestboyhq/malini && cd malini
corepack enable pnpm   # once; the repository pins pnpm 12
pnpm install
pnpm dev               # the app, with hot reload
```

Run the checks with `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e`, which drives the built app with Playwright in the background.
`pnpm dist` builds an unsigned app under `apps/malini/release/`.

| Path                              | What                                                                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/malini`                     | the Electron app                                                                                                                                           |
| `apps/malini/src/lib`             | one folder per domain: `app`, `chat`, `pull-requests`, `jobs`, `routines`, `extensions`, `browser`, `stats`, and the shared `repositories` and `providers` |
| `apps/malini/src/main`            | main-process bootstrap: database, IPC registry, git, docker, processes                                                                                     |
| `apps/malini/src/contract`        | the typed command and event contract between the two processes                                                                                             |
| `packages/agent-bridge`           | the agent process the app runs every chat through                                                                                                          |
| `packages/extension-api`          | the extension contract and its test host                                                                                                                   |
| `packages/hyper-ui`               | the design system: components, icons, tokens                                                                                                               |
| `packages/eslint-plugin-hyper-ui` | the lint rules, including the domain boundaries                                                                                                            |
| `extensions/repository`           | the Repository extension: the Files panel                                                                                                                  |

## Contributing

Issues and pull requests are welcome.
Read [AGENTS.md](AGENTS.md) for the conventions and [`.agents/rules/`](.agents/rules) for the rule of the area you touch.
Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), and every merged `feat`, `fix`, or `perf` ships to users as an in-app update.

malini is a sibling of [Grip](https://github.com/bestboyhq/grip), the free and open source screen recorder, and [Tony](https://github.com/bestboyhq/tony), free and open source dictation for the Mac.

## License

Copyright (C) 2026 Best Boy

malini is licensed under [AGPL-3.0-only](LICENSE).
`packages/extension-api` is licensed under [MIT](packages/extension-api/LICENSE), so an extension can use any license.

Additional permission under GNU AGPL version 3 section 7: if you modify this program, or any covered work, by linking or combining it with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, or a modified version of that library), containing parts covered by the terms of Anthropic's license for that SDK, the licensors of this program grant you additional permission to convey the resulting work.

Claude, Claude Code and the Claude logo are trademarks of Anthropic, PBC.
Third-party names and logos are not covered by this license and appear only to identify those products.
