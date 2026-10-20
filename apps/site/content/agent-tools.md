---
title: Agent tools
description: The tools the agent gets in a Malini chat - a browser it shares with you, and your jobs, routines, and events - and how writes ask for your approval.
---

In a Malini chat, the agent has Claude Code's own tools plus Malini's.
Malini's tools reach Claude Code through an MCP server named `malini`, so their full names start with `mcp__malini__`.

## Browser

The agent drives the same browser tabs you see in the inspector, and the tabs it opens show up beside yours.

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

## Jobs, routines, and events

| Tool            | What it does                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `jobs_list`     | Lists your [jobs](/malini/docs/jobs.md): id, name, where they run, what they ship, model, and effort. |
| `jobs_save`     | Creates a job, or changes one by id.                                                                  |
| `jobs_run`      | Starts a job now, with optional extra context. The run shows in the chat.                             |
| `routines_list` | Lists your [routines](/malini/docs/routines.md): id, state, label, when, and steps.                   |
| `routines_save` | Creates a routine, or changes one by id.                                                              |
| `events_list`   | Lists every event Malini emits: its channel, what it means, and its payload type.                     |

`events_list` returns the same data as the [events reference](/malini/docs/reference/events.md).
The agent uses it to write an `on <channel>` trigger and its `where` clause.

## Writes ask first

- The read tools, `jobs_list`, `routines_list`, and `events_list`, run without asking.
- Every `jobs_save`, `jobs_run`, and `routines_save` asks for your approval in the chat.
- A routine the agent creates starts as a **draft**: it never runs on its own until you promote it.

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
