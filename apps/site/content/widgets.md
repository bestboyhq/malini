---
title: Widgets
description: A board of live tiles beside every chat - widgets you make land on it at once, your repository's widgets wait under it for one click, and a Plan widget your team edits together.
---

The inspector beside a chat has a board of widgets under its card.
A widget is a small live tile: a deploy that passed, the days until a launch, rooms booked per week as a line, your plan.
Malini draws every tile, so a widget your agent made looks like the rest of Malini.

## The board

There is one board per repository, and every workstream of that repository shows it.
What is on the board is on the board: Malini saves every change at once, and nothing waits to be pinned or allowed.
A widget takes any span of whole cells, from one cell to as wide as the panel and 12 cells tall.
A new widget starts two cells wide and one tall, first on the board.
A tile shows what fits its span: a number in one cell, a number with its chart or a few rows in two, and more of the chart and its labels the bigger it gets.

- Click a tile to open what it reads, such as the deploy run, in a Browser tab.
  A row with a link opens that link.
- Drag a tile to move it.
  The tile follows the pointer, and an outline shows where it lands.
  Escape puts it back.
- Option and an arrow key moves the focused tile one place.
- Drag its corner to resize it.
  It snaps to whole cells, and a tile as wide as the panel stays that wide when only its height changes.
- **⋯**, or a right-click, opens its menu.
  The top says whose widget it is, where it reads from and when it last did.
  **Make default for this repository** is on your own widgets, and **Remove** is on every widget.

Drag the left edge of the inspector to make the column wider, up to 620 pixels.
The card above the board widens with it, and Malini keeps the width.

Which widgets sit on your board, in which order and at which size, is yours alone.
Nobody else's board changes when you move, add or remove a tile.

## Your widgets and the repository's

A widget is one of two kinds.

- **Your own.**
  A widget you or your agent makes lives in Malini on your Mac, not in a worktree.
  The menu says **Only on your board**, and **Remove** deletes it.
- **The repository's.**
  A widget file on the repository's default branch, `.malini/widgets/<id>.json`.
  The menu says **Default for this repository** with its author, and **Remove** takes it off your board only.

Under the board, **In owner/repo** lists the repository's widgets that are not on your board, each with its author's GitHub picture.
**Add** puts one first on your board.
Malini never puts a repository widget on your board by itself.

### Make one a default

**Make default for this repository**, in your own widget's menu, starts a workstream of the repository in the background.
Malini copies the widget file into `.malini/widgets/` there, and the agent checks it for secrets and private data and opens a draft pull request.
Once it merges, every teammate finds it under their board, and on yours it turns into the repository's widget.

### Updates reach everyone

Malini fetches the default branch every few minutes and checks its `.malini/widgets` folder every minute.
When a repository widget changes there, every board that shows it reads the new version at once, and the list under the board shows the new title.
Nobody presses anything.

## Make a widget

**New widget**, under the board, asks what the widget should show.
Return starts a workstream of the repository with that prompt, so the agent builds the widget there and you leave when it is done.

You can also ask the agent in any chat, as the next section says.

## Shared or yours

Every widget names whose data it reads.

- A people mark means shared: everyone sees the same numbers, such as a deploy status.
- A lock means yours: each person sees their own, such as the pull requests waiting on them.

## Widget files

A widget is one JSON object, in Malini for your own and in `.malini/widgets/<id>.json` on the default branch for the repository's.

```json
{
	"title": "Visitors",
	"icon": "trend-up",
	"scope": "shared",
	"source": {
		"mcp": {
			"server": "logdash",
			"tool": "trend",
			"arguments": {
				"clusterId": "0123456789abcdef01234567",
				"events": [{ "name": "pageview" }],
				"days": 14
			},
			"url": "https://mcp.logdash.io/mcp"
		},
		"select": "{value: .series[0].total, unit: \"views\", chart: {kind: \"line\", labels: .times, series: [{label: \"Views\", values: .series[0].counts}]}}"
	},
	"refresh": { "every": 600 },
	"author": "your-login"
}
```

The source is one of two kinds:

- `mcp` calls a tool of one of your [MCP servers](/malini/docs/agent-tools.md#mcp-servers) with fixed `arguments`, the way your agent calls it, and `select` shapes its answer with jq.
  Malini runs only a tool its server marks read-only, so a widget never changes data.
  `url` is the address of a remote server, so a teammate who lacks it can add it from the tile.
- `github` reads a GitHub API path with `gh api`, under your own sign-in, and `select` shapes the answer with jq.
  `{owner}` and `{repo}` are the repository's.

Widgets run no scripts.
A widget from an older Malini that runs a command shows **Widgets read MCP servers now, not scripts.** until your agent moves it to a server.

Either way, the source gives one JSON object, and Malini draws what it finds there:

| Field                      | What Malini draws                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `value`, `unit`, `caption` | A big number with its unit, and a line under it.                                                          |
| `delta`                    | The change next to the number, such as `+18%`.                                                            |
| `chart`                    | A line or bar chart: `kind`, `labels`, and up to 3 `series` of a `label` and up to 120 `values`.          |
| `percent`                  | A ring, from 0 to 100.                                                                                    |
| `state`, `history`         | A status mark, `success`, `failure`, `running` or `idle`, and a strip of the last runs.                   |
| `rows`                     | A list of `label`, `value`, `max`, `detail`, `state` and `url`; bars when rows carry a `value` and `max`. |
| `url`                      | What a click on the tile opens.                                                                           |

A trend gets a `chart` with the latest `value` beside it.
A number that only matters now gets `value` alone.
Hover a chart to read each point.

`refresh.every` is in seconds, 300 when it is missing and 15 at least.
`refresh.on` lists Malini [events](/malini/docs/reference/events.md) that read the widget again, such as a merge.

## When Malini reads

Malini reads only the widgets on your board, and only while a board is on screen and Malini's window is visible.
It reads a new widget at once, then on the widget's timer and on its events.
A read that fails keeps the last numbers it got, dimmed, and the menu says when they are from.
A warning sign in the tile's header says why the read failed.
The last numbers stay across restarts, so a board opens full.

Adding a widget to your board allows it to read.
A repository widget reads what the default branch says, through your own servers and your own sign-ins.
It reaches nothing but the server it names, or GitHub, as you, and it can only read.

### When a tile needs you

A widget that reads an MCP server you cannot reach says why, with one button.

- **Add logdash**: the server is not one of yours.
  Malini starts a workstream whose agent adds it with `mcp_servers_add`, at the widget's `url`, and signs you in.
- **Sign in to logdash**: the server needs a sign-in.
  Malini opens its sign-in page, as **Fix MCP servers** does.
- **Turn on logdash**: you turned the server off.

Once the server connects, the tile reads again by itself.
A widget that still runs a script shows no numbers, only that widgets read MCP servers now: ask the agent to move it to one.
`select` needs `jq`, which macOS 15 and later ship.

## Widgets your agent makes

Ask the agent for a widget, or for numbers you want to keep an eye on.
It saves the widget with the `widgets_save` [tool](/malini/docs/agent-tools.md#widgets) into your own widgets, and the widget lands first on your board and reads at once.
The chat shows it as a card with the live tile, at the size it has on your board.

- **On your board** says where it is, and **Remove** takes it away.
- The agent saves again to change it, and the tile on your board changes with it.
- **Make default for this repository** in the tile's menu shares it with your team.

## The Plan widget

Every board of a GitHub repository starts with **Plan**: the repository's [initiatives](/malini/docs/initiatives.md), the same outcomes and dependencies as its page.
An edit in either place shows in the other at once, and a click on the title **Plan** opens that page.

- One column wide, it shows the next outcome and how much of it is done.
- One cell tall, it lists the next three outcomes.
- Any bigger, it lists every outcome under its day, with its dependencies under it, and the outcomes with no date last.
  It starts as wide as the panel and two cells tall.
- Tick the circle of an outcome or a dependency to finish it, and tick it again to undo it.
  Click a title to rename it, and **↑** and **↓** move between titles.
- Return in **Name an outcome** adds it and keeps the field for the next one.
  The **+** on an outcome adds dependencies to it until you press Escape.
- **Start workstream** on a dependency starts one in this repository.
- **This chat** marks the dependency the workstream you are in serves, and **Needs you** marks one waiting on you.

Turn on **Share internally**, beside the widget's title, to share the plan with your team, as [one file in a private plan repository](/malini/docs/initiatives.md#share-internally).
Its tooltip says who sees it.
When a teammate [asks you to share](/malini/docs/initiatives.md#ask-the-owner) and you press **Share**, the Plan comes back first on your board, even after you removed it.
