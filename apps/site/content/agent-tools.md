---
title: Agent tools
description: The tools the agent gets in a Malini chat - a browser it shares with you, files it opens for you to fill in, your repositories and workstreams, your jobs and events - how you decide how often they ask, and where you see every call.
---

In a Malini chat, the agent has Claude Code's own tools plus Malini's.
Malini's tools reach Claude Code through an MCP server named `malini`, so their full names start with `mcp__malini__`.

## Browser

The agent drives the same browser tabs you see in the inspector, and the tabs it opens show up beside yours.
A tab shows up as soon as the agent starts opening its page, and a page that does not load says why, such as `ERR_CONNECTION_REFUSED` while your dev server starts.

| Tool                 | What it does                                   |
| -------------------- | ---------------------------------------------- |
| `browser_open`       | Opens a web page or a file from the worktree.  |
| `browser_screenshot` | Captures the open page.                        |
| `browser_click`      | Clicks the first element a CSS selector finds. |
| `browser_type`       | Types into a field, optionally pressing Enter. |
| `browser_back`       | Goes back one page.                            |
| `browser_forward`    | Goes forward one page.                         |
| `browser_reload`     | Reloads the page.                              |
| `browser_resize`     | Makes the tab wider or narrower.               |

When a page is too narrow or too wide for what it checks, the agent calls `browser_resize` with the width the page should get.
Malini moves the divider between the chat and the inspector, the one you drag, and the width stays until you drag it back.
The chat and the inspector keep their minimum widths, so the page may end up narrower or wider than asked, and the agent hears how wide it got.
Only the tab you see resizes: while you look at another tab or workstream, or Malini is hidden, its width stays and the agent hears why.

You can also pick an element on a page, and it lands in your prompt.
The agent's screenshots work while Malini is hidden, minimized, or behind other windows, so you can keep working elsewhere.

### Screenshots in your theme

Screenshots come out in the theme you see Malini in: **Settings > Appearance > Theme**, or your system's when that is set to System.
Pages in the browser follow it through `prefers-color-scheme`.
The agent is told the theme too, so it switches anything else it captures, such as your app's window or a simulator, before it takes the shot.
Commands the agent runs see it as `MALINI_THEME`, `light` or `dark`.
Any other screenshot, recording, or image the agent makes goes under `.context/` in the worktree, which Malini keeps out of git, so it shows in the chat and stays with the workstream.
The agent gives each capture a new name and leaves it there, and Malini keeps its own copy of whatever a chat shows until the workstream is deleted.

## Files you fill in

Some things only you should write, such as an API key in `~/.secrets/<repo>.env`.
The agent never reads or writes those files, so it opens the file for you instead of asking you to paste the secret into the chat.

| Tool         | What it does                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------- |
| `files_open` | Opens a file in a tab beside the chat, where you edit it, at the line the agent names if any. |

- The path is absolute, under `~/`, or relative to the worktree, and the agent says in its report what goes in the file.
- The tab opens kept, not as a preview, so the next file you open never replaces it.
- A file that does not exist yet opens empty, and Malini creates it.
  Outside the worktree it is private to you: the file is readable only by you, and so is a folder Malini creates for it.
- The agent gets back the path and whether Malini created the file, never what the file holds.
- A tab can read and save a file outside the worktree only after an agent opened that file in that workstream, and it keeps that access after you quit and reopen Malini.
- While streamer mode hides personal data, a secrets file or a file from outside the worktree stays hidden behind a **Show** button that names it.

## Repositories and workstreams

The agent can do in Malini what you do from the sidebar, short of removing anything.

| Tool                  | What it does                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `repositories_list`   | Lists your repositories: id, `owner/name`, default branch, whether Malini has cloned it, and whether it is hidden. |
| `repositories_clone`  | Adds a repository by `owner/name` or git URL and clones it, or shows a hidden one again.                           |
| `repositories_hide`   | Hides a repository from the sidebar. Its clone and workstreams stay, under **Hidden**.                             |
| `workstreams_list`    | Lists your workstreams: id, name, repository, branch, base branch, and which one the chat runs in.                 |
| `workstreams_create`  | Starts a workstream of a repository, cloning it first when needed, with a chat that gets the agent's prompt.       |
| `workstreams_archive` | Archives a workstream, keeping its branch and uncommitted work under **Archived**, where you can restore it.       |

A clone that takes longer than 40 seconds keeps going in the background, and the agent waits for it by calling `repositories_clone` again.
A workstream the agent starts opens on its new chat, and the sidebar shows it **Setting up** while Malini updates its branch and installs its dependencies.
Once it is set up, Malini sends the agent's prompt as that chat's first message, with the model and settings of the chat that asked, and **Name chats** names the chat and the workstream from it.
The approval card shows that prompt before you allow it.
The agent cannot archive the workstream its own chat runs in, and no tool removes a repository or deletes a workstream.

To change code in another repository, such as your fork, the agent clones it with `repositories_clone` and starts a workstream there with `workstreams_create`.
The workstream starts from the default branch, or from the tag, branch or commit the agent names in `base`, such as the release you run, `v0.17.5`.
Malini fetches that from the repository's origin, and the workstream's pull request still targets the default branch.
When it reaches for `git checkout` or `git worktree` instead, Malini refuses the command and names those tools.
A `git clone` still runs, for reading code, and Malini reminds the agent to start a workstream before it changes any.

## Jobs and events

| Tool          | What it does                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `jobs_list`   | Lists your [jobs](/malini/docs/jobs.md): id, name, instructions, where they run, model, effort, skills, `when` with its mode, and `then`.    |
| `jobs_save`   | Creates a job, or changes one by id: its skills, its `when` trigger, and its `then` job included.                                            |
| `jobs_run`    | Asks Malini to run a job, in the chat's workstream or another one, such as one it started, with optional extra context, and returns at once. |
| `events_list` | Lists every event Malini emits: its channel, what it means, and its payload type.                                                            |

`when` is a job's [event trigger](/malini/docs/jobs.md#when-a-job-runs), and `then` names the job that runs next, by id or exact name, such as **Open draft** or **Merge**.
`events_list` returns the same data as the [events reference](/malini/docs/reference/events.md).
The agent uses it to write an `on <channel>` trigger and its `where` clause.
A run the agent starts waits in its chat's composer tray until it finishes, wherever it runs.

## Tools and jobs

A tool does one thing at once, such as cloning a repository.
A job is a process with steps: **Merge** waits for checks, runs **Fix checks** and **Resolve conflicts** when it has to, and only then merges.
So the agent clones, hides, starts and archives with tools, and opens drafts and merges by running the **Open draft** and **Merge** jobs.

## Shipping is your call

Malini owns commits, pushes, and pull requests, so the agent cannot commit, push, open a pull request or merge one from its shell.
The agent runs **Open draft** or **Merge**, or sets either as a job's `then`, only when you explicitly asked for it in the chat.
Finished work, passing tests and green checks are never a reason for it to ship on its own.

When you ask it to ship, it runs **Open draft** and goes on with its turn.
Once the turn ends, Malini commits with the turn's `Commit:` line, pushes the branch, and opens the draft under its `Pull request:` title, the same way **Draft** in the top bar does.
When the workstream already has an open pull request, Malini pushes the new work to it instead.
A failure shows in the top bar, where pull request problems always do.

### Workstreams it starts

When the agent hands work to workstreams it starts with `workstreams_create`, and you asked it to ship or merge that work, it ships each one from your chat instead of asking that workstream's chat to.
Right after it starts a workstream, it runs **Open draft** or **Merge** there with `jobs_run`, so you approve it in the chat you are in, and **Always allow** for that chat covers the rest.
Malini holds each run while that workstream sets up and its chat works, then does what **Draft** or **Merge** in its top bar does once the chat ends its turn.
So a chat that starts five workstreams and merges them leaves you five merged pull requests and five archived workstreams, not five drafts to click through.

Until it finishes, the run waits in your chat's composer tray as a row that names the workstream it runs in, such as **Merge · Job in Fetch command**.
Merge still waits for checks, fixes what fails and resolves conflicts first, and a problem shows in that workstream's top bar.

## You decide how often it asks

- The read tools, `jobs_list`, `events_list`, `repositories_list` and `workstreams_list`, run without asking, and so does `files_open`, which only opens a file for you.
- Every other Malini tool asks in the chat the first time: **Deny**, **Allow once**, or **Always allow** for this chat, this workstream, or everywhere.
- **Always allow** remembers one action: cloning repositories, hiding them, starting workstreams, archiving them, saving jobs, or running one job.
  Always allowing **Release notes** to run never lets the agent run any other job.
- **Settings > Agent access > Always allowed** lists everything you always allow, and **Revoke** takes it back.
- A trigger the agent adds starts **Off**: the job never runs on its own until you turn it on from the [Jobs page](/malini/docs/jobs.md).

## See what the agent did

A chat is a job without a preset, so **Jobs > Activity** lists both as runs, by day: job runs marked **Job** and chat turns marked **Chat**.
A chat turn shows when its agent called Malini's tools; turn on **Every chat turn** to list the latest ones too.

- **N calls** on a run folds open every call its agent made to Malini, in order: what it was, how it was approved, and when it finished.
- Open a call to see what the agent called it with and what came back, or the error, and **Open chat** to read the turn that made it.
- A call you denied shows too, as **You denied it**.
- A job an agent started with `jobs_run` reads **Started by an agent**, and its own calls fold under it.

## Edits you review

A job runs without asking when it is built in, when you always allow it to run, when its trigger is not Off, or when it is the Then of such a job.
When the agent changes such a job, Malini shows you the change instead of saving it, and **Always allow** never skips this.

- Each changed setting, such as the model, the When, or the Then, gets its own row with **Accept** and **Reject**.
- The instructions show as a diff you can edit, and each change in them has its own **Accept** and **Reject**, with **Accept all** and **Reject all** above.
- **Save** keeps every change you did not reject, plus your own edits, and the agent gets the version you saved.
- **Reject** keeps the job as it was.

## Example

> Every time one of my pull requests merges, update the docs and open a draft PR.

The agent can read `events_list`, find `pull-requests:ship-changed`, and save a job:

```json
{
	"name": "Docs after merge",
	"instructions": "Bring the docs up to date with the pull request that merged.",
	"when": "on pull-requests:ship-changed where merged is set",
	"then": "Open draft"
}
```

You approve the save, and its trigger starts Off.
Turn it on from the Jobs page, as **Ask me first** or **On its own**, when you trust it.
