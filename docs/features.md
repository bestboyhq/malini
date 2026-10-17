# Features

Everything malini does, in one place.
The [README](../README.md) has the short version.

## Made for many agents at once

| The problem                                                              | What malini does                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two agents edit one checkout and clobber each other                      | Every workstream is its own **git worktree** on `malini/<id>`, branched from a private clone of the repository.                                                                 |
| An agent commits half-done work or opens a pull request you never wanted | The agent bridge **refuses commit, push, rebase, reset, and `gh pr create`**. malini owns the history.                                                                          |
| A new prompt kills the run in flight                                     | **↵ queues** the prompt after the current run. **⌘↵ steers** it now.                                                                                                            |
| A run "finishes" while its dev server and subagents still work           | A run **stays open while its background commands and agents run**, and you can stop each one.                                                                                   |
| One bad turn wrecks the branch                                           | Every run has **Undo**. Edit an earlier message to resend from there, or **fork to a new chat**, even mid-run.                                                                  |
| You can't tell whether a turn is really done                             | Every turn ends with a report: **Done**, **Done with something deferred**, or **Waiting on you**, with what changed, what was verified, and the commit and pull request titles. |
| You come back to ten agents and can't tell which one needs you           | Every turn ends with a **Your turn** list, unread workstreams are marked, and a chime and a notification tell you a run finished.                                               |
| The pull request sits red for hours                                      | The merge queue runs **Fix checks**, **Update from main**, and **Address bot review** until it merges, and says **Needs you** only when it must.                                |
| The merge lands a commit nobody checked                                  | malini merges with `--match-head-commit`, so GitHub merges **exactly the commit that passed**.                                                                                  |
| Quitting the app halfway through a run loses the work in flight          | Runs that a restart cut short **pick up where they left off** the next time malini opens.                                                                                       |

## First launch

<p align="center">
  <img src="../.github/readme/setup.webp" width="100%" alt="The first-run setup, step 1 of 4, Connect Claude Code and GitHub: both rows show a green check and Signed in as, with the Claude email blurred, and a Continue button.">
</p>

- **Both accounts, side by side.** Setup connects Claude Code and GitHub one at a time: **Install** and **Sign in** for Claude Code, and a one-time code in your browser for GitHub.
  malini ships the GitHub CLI, so you don't install it or run `gh auth login` yourself, and a `gh` you installed still comes first.
- **Skill presets, suggested.** Setup reads the skills you already have and proposes presets you add with one click.
- **Your jobs, introduced.** The built-in jobs are one slash away from any chat.
- **Then a repository.** Clone one or open a folder, and your first workstream is ready.

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
  <img src="../.github/readme/answers.webp" width="100%" alt="A grip workstream answering how captions, zooms and keystrokes stay in sync after cuts and speed changes, with a file and line reference for each step, next to the other workstreams in the sidebar.">
</p>

<p align="center">
  <sub>Ask about the code and get an answer with file references. Every workstream keeps its own chats.</sub>
</p>

## A chat that keeps up

<p align="center">
  <img src="../.github/readme/run-options.webp" width="100%" alt="The Run options menu open over a chat: Plan mode, Agent access with Sandboxed checked, Auto, and Full access, Report with Low, Medium checked, and High, and Model settings.">
</p>

<p align="center">
  <sub>Plan mode, how much the agent may do on its own, and how much it reports back, one menu from the composer.</sub>
</p>

- **Queue or steer.** **↵** queues a prompt after the current run, **⌘↵** interrupts the turn and steers, while background commands keep running.
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
  Plan usage follows the Claude account you're signed in to, and **Sign in with another account** in the model picker switches it.
- **Undo, edit, fork.** Every run can be undone.
  Edit an earlier message to resend from there, or fork to a new chat while the agent is still busy.

## From prompt to merged

- **Draft** opens a draft pull request.
  The agent writes the commit subject and the pull request title in your repository's convention, and malini commits, pushes, and opens it.
- **Merge** queues it: push, mark ready, update from main, wait for checks and review, and merge with the repository's own merge method.
  The workstream archives itself when it lands.
- **While it waits, it works.** The queue runs **Fix checks**, **Update from main**, and **Address bot review** as needed, then replies to and resolves the bot threads it fixed.
- **Needs you, only when it does.** A reviewer wants an answer, a fix gave up, GitHub blocks the merge, or your GitHub sign-in expired, which you fix from the GitHub card in Settings.
- **The whole pull request in the top bar.** Checks, changes, and review live one click away, and **Continue** keeps working on the latest base once it merges.

## Skills, in presets

<p align="center">
  <img src="../.github/readme/skills.webp" width="100%" alt="The composer's Skills for this chat menu open over a chat: All skills, and the presets Builder (default, checked), Motion designer, Designer, Reviewer, and Founder with their skill counts, a skill filter, repository and personal skills, and Edit presets.">
</p>

- **Claude Code loads every skill, every time.** malini lets you choose.
- **A preset is a named group of skills,** with an emoji if you like.
  Drag skills into presets under Settings, Skills, and make one the default for new chats.
- **Pick per chat and per job.** The composer shows the chat's preset and its skill count, and a job carries a preset of its own.
  A chat can also use all skills, or a list you pick.
- **Suggested from your own skills.** A built-in job, **Suggest skill presets**, sends the names and descriptions of your skills through your own Claude Code and proposes presets.
- **A filter, not a sandbox.** A skill outside the preset is hidden from the model and refused by the Skill tool, but its files stay readable.

## Jobs and routines

<p align="center">
  <img src="../.github/readme/jobs.webp" width="100%" alt="The Jobs page: the five built-in jobs, Name chats, Suggest skill presets, Fix checks, Update from main, and Address bot review, with the Fix checks job open to show its instructions, model, effort, skills, and Reset and Run buttons.">
</p>

- **A job is agent work you reuse.** A name, instructions, a model, an effort, and a skill preset.
  Run it in this workstream or a new one, and pick what happens when it finishes: nothing, a draft pull request, or a queued merge.
- **Five jobs come built in.** **Fix checks**, **Update from main**, and **Address bot review** get a pull request merged.
  **Name chats** names a chat from its first message, and **Suggest skill presets** runs in setup.
  Type **/** in the composer to run one from a chat, and its result lands in that chat.
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
- **Panels, commands, settings, and workflows** come from an extension's manifest, and an extension reaches the workstream through [`packages/extension-api`](../packages/extension-api).
  The API is MIT licensed, so an extension can use any license.

## Stats

- **What it costs your Mac, right now.** Memory and CPU for malini, its agents, the tools they started, browser tabs, and Docker, one click from the sidebar.
- **What you got done.** Agents running, runs today, your streak, six months of activity, and where you work.
  Counted on this Mac only.

## Private by design

There is no malini account and no malini server.
Your code leaves your Mac only through your own Claude Code, to Anthropic, and the GitHub CLI, to GitHub.
malini makes two calls of its own: update checks to GitHub Releases, and anonymous usage data to PostHog.
Usage data says which features are used and which errors happen, and never contains your code, prompts, paths, or keys.
Turn it off under Settings, Privacy, Share usage data.

**Streamer mode** blurs email addresses and your user name in paths.
Auto blurs while OBS or another streaming app runs, and you can set it to On or Off under Settings, Privacy.

Updates download in the background and install when you quit, or right away with **Restart to Update**.

## Keys

| Key             |                                                        |
| --------------- | ------------------------------------------------------ |
| **↵**           | Send, or queue after the current run                   |
| **⌘↵**          | Steer now, interrupting the run                        |
| **@**           | Mention a file                                         |
| **⌘W**          | Close the chat tab                                     |
| **⌘K**          | Find a chat tab that doesn't fit                       |
| **⌥↑** / **⌥↓** | Move a repository, a workstream, or an inspector panel |
