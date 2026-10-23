---
title: Agent tools
description: The tools the agent gets in a Malini chat - a browser it shares with you, your jobs, routines, and events, and a draft pull request - and how you decide how often they ask.
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

You can also pick an element on a page, and it lands in your prompt.
The agent's screenshots work while Malini is hidden, minimized, or behind other windows, so you can keep working elsewhere.

### Screenshots in your theme

Screenshots come out in the theme you see Malini in: **Settings > Appearance > Theme**, or your system's when that is set to System.
Pages in the browser follow it through `prefers-color-scheme`.
The agent is told the theme too, so it switches anything else it captures, such as your app's window or a simulator, before it takes the shot.
Commands the agent runs see it as `MALINI_THEME`, `light` or `dark`.
Any other screenshot, recording, or image the agent makes goes under `.context/` in the worktree, which Malini keeps out of git, so it shows in the chat and stays with the workstream.

## Jobs, routines, and events

| Tool            | What it does                                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `jobs_list`     | Lists your [jobs](/malini/docs/jobs.md): id, name, instructions, where they run, what they ship, model, effort, and skills. |
| `jobs_save`     | Creates a job, or changes one by id, skills included.                                                                       |
| `jobs_run`      | Starts a job now, with optional extra context. The run shows in the chat.                                                   |
| `routines_list` | Lists your [routines](/malini/docs/routines.md): id, state, label, when, and steps.                                         |
| `routines_save` | Creates a routine, or changes one by id.                                                                                    |
| `events_list`   | Lists every event Malini emits: its channel, what it means, and its payload type.                                           |

`events_list` returns the same data as the [events reference](/malini/docs/reference/events.md).
The agent uses it to write an `on <channel>` trigger and its `where` clause.

## Pull requests

| Tool                       | What it does                                                     |
| -------------------------- | ---------------------------------------------------------------- |
| `pull_requests_open_draft` | Opens a draft pull request of the workstream once the turn ends. |

Malini owns commits, pushes, and pull requests, so the agent cannot commit, push, or open a pull request from its shell.
When you ask it to ship, it calls `pull_requests_open_draft` and goes on with its turn.
Once the turn ends, Malini commits with the turn's `Commit:` line, pushes the branch, and opens the draft under its `Pull request:` title, the same way **Draft** in the top bar does.
When the workstream already has an open pull request, Malini pushes the new work to it instead.
A failure shows in the top bar, where pull request problems always do.

## You decide how often it asks

- The read tools, `jobs_list`, `routines_list`, and `events_list`, run without asking.
- Every other Malini tool asks in the chat the first time: **Deny**, **Allow once**, or **Always allow** for this chat, this workstream, or everywhere.
- **Always allow** remembers one action: opening drafts, saving jobs, saving draft routines, or running one job.
  Always allowing **Release notes** to run never lets the agent run any other job.
- **Settings > Agent access > Always allowed** lists everything you always allow, and **Revoke** takes it back.
- A routine the agent creates starts as a **draft**: it never runs on its own until you promote it.

## Edits you review

A job runs without asking when it is built in, when you always allow it to run, or when a promoted routine runs it.
When the agent changes such a job, or a promoted routine, Malini shows you the change instead of saving it, and **Always allow** never skips this.

- Each changed setting, such as the model or the trigger, gets its own row with **Accept** and **Reject**.
- The instructions show as a diff you can edit, and each change in them has its own **Accept** and **Reject**, with **Accept all** and **Reject all** above.
- **Save** keeps every change you did not reject, plus your own edits, and the agent gets the version you saved.
- **Reject** keeps the job or routine as it was.

## Example

> Every time one of my pull requests merges, update the docs.

The agent can read `events_list`, find `pull-requests:ship-changed`, and save a draft routine:

```json
{
	"label": "Docs after merge",
	"when": "on pull-requests:ship-changed where merged is set",
	"steps": ["Update docs"]
}
```

You approve the save, then promote the routine when you trust it.
