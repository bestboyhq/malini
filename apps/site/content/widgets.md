---
title: Widgets
description: A board of live tiles under the inspector, beside every chat, drawn from widget files your repository shares, with a Plan widget your team edits together and widgets your agent makes for you.
---

The inspector beside a chat has a board of widgets under its card.
A widget is a small live tile: a deploy that passed, the days until a launch, the rooms booked this week, your plan.
Malini draws every tile, so a widget your agent made looks like the rest of Malini.

## The board

There is one board per repository, and every workstream of that repository shows it.
Widgets come in three sizes, the way they do on a phone: **Small** is one cell, **Medium** is two cells wide, and **Large** is two by two.
A tile shows what fits its size: a number or a ring when small, a few rows when medium, everything when large.

- Click a tile to open what it reads, such as the deploy run, in a Browser tab.
  A row with a link opens that link.
- Drag a tile to move it.
- Drag its corner to resize it.
  It snaps to Small, Medium or Large.
- **⋯**, or a right-click, opens its menu: the three sizes, **Refresh now**, **Ask to change it**, **Open file**, and **Remove**.
  The top of the menu says where the widget reads from and when it last did.
- **Ask for a widget**, the last tile, puts a prompt in the chat's composer for you to finish.

Drag the left edge of the inspector to make the column wider, up to 620 pixels.
The card above the board widens with it, and Malini keeps the width.

Which widgets sit on your board, in which order and at which size, is yours alone.
Nobody else's board changes when you move a tile.

## Shared or yours

Every widget names whose data it reads.

- A people mark means shared: everyone sees the same numbers, such as a deploy status.
- A lock means yours: each person sees their own, such as the pull requests waiting on them.

## Widget files

A widget is a JSON file in the repository, `.malini/widgets/<id>.json`.
It reaches your team the way code does: through the pull request that adds it.

```json
{
	"title": "Deploy",
	"icon": "workflow",
	"scope": "shared",
	"source": {
		"github": "repos/{owner}/{repo}/actions/runs?per_page=12",
		"select": "{state: (.workflow_runs[0].conclusion // \"running\"), history: [.workflow_runs[].conclusion]}"
	},
	"refresh": { "every": 120, "on": ["pull-requests:ship-changed"] },
	"size": "small",
	"url": "https://github.com/acme/web/actions",
	"author": "your-login"
}
```

The source is one of two kinds:

- `github` reads a GitHub API path with `gh api`, under your own sign-in, and `select` shapes the answer with jq.
  `{owner}` and `{repo}` are the repository's.
- `command` runs a shell command in the workstream's checkout, such as `node scripts/rooms.mjs`, and reads what it prints.

Either way, the source prints one JSON object, and Malini draws what it finds there:

| Field                      | What Malini draws                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `value`, `unit`, `caption` | A big number with its unit, and a line under it.                                                          |
| `delta`                    | The change next to the number, such as `+18%`.                                                            |
| `percent`                  | A ring, from 0 to 100.                                                                                    |
| `state`, `history`         | A status mark, `success`, `failure`, `running` or `idle`, and a strip of the last runs.                   |
| `rows`                     | A list of `label`, `value`, `max`, `detail`, `state` and `url`; bars when rows carry a `value` and `max`. |
| `url`                      | What a click on the tile opens.                                                                           |

`refresh.every` is in seconds, 300 when it is missing and 15 at least.
`refresh.on` lists Malini [events](/malini/docs/reference/events.md) that read the widget again, such as a merge.

## When Malini reads

Malini reads a widget only while a board that shows it is on screen and Malini's window is visible.
It reads on the widget's timer and on its events, and **Refresh now** reads at once.
A read that fails keeps the last numbers it got, dimmed, and the menu says when they are from.
The last numbers stay across restarts, so a board opens full.

A widget that runs a command runs only once you put it on your board.
Putting it there allows that exact command.
When someone changes the command in the file, the tile shows the new command with **Allow**, and runs nothing until you press it.
A widget that reads GitHub reads at once, since it reaches nothing but GitHub, as you.

## Suggestions

Widgets your team adds never land on your board by themselves.
Every widget file you have not placed shows faded in one stack under your board, with its author's GitHub picture and name.

- Scroll over the stack, or click its dots, to flip through.
- Click a suggestion, or **Add**, to put it on your board, or drag it to the spot you want.
- **×** hides it, and it stays hidden for you.

A widget someone else made keeps their picture in its header once it is on your board.

## Widgets your agent makes

Ask the agent for a widget, or for numbers you want to keep an eye on.
It writes the widget file in your workstream with the `widgets_save` [tool](/malini/docs/agent-tools.md#widgets), and the chat shows it as a card: the tile in **Small**, **Medium** and **Large**, live.
A narrow chat shows one size, with a switch for the others.

- **Pin to my panel** puts it on your board.
  You can also drag the tile from the chat onto the board.
- A widget that runs a command shows the agent's sample in the chat, and the real numbers once you pin it.
- Your teammates get it as a suggestion once the pull request merges.

## The Plan widget

Every board of a GitHub repository starts with **Plan**: the repository's [initiatives](/malini/docs/initiatives.md), the same outcomes and dependencies as its page.
An edit in either place shows in the other at once.

- Small shows the next outcome and how much of it is done.
- Medium and Large list the outcomes by day, with their dependencies under them.
- Tick a dependency to finish it, click a title to rename it, and add a dependency under an outcome.
- **Start workstream** on a dependency starts one in this repository.
- **This chat** marks the dependency the workstream you are in serves, and **Needs you** marks one waiting on you.

In a private repository, turn on **Sync with GitHub** to share the plan with your team, as [milestones and issues](/malini/docs/initiatives.md#sync-with-github).
