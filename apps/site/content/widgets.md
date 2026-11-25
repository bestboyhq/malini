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

**Make default for this repository**, in your own widget's menu, copies the widget file into `.malini/widgets/` in this workstream's worktree.
Then it asks the chat you are in to check the file for secrets and private data and to open a draft pull request, so the widget ships with the rest of the workstream's work.
Hold ⌘ and it turns into **Make default in a new chat**: the same prompt goes to a new chat in this workstream, while you stay where you are.
Once it merges, every teammate finds it under their board, and on yours it turns into the repository's widget.

### Updates reach everyone

Malini fetches the default branch every few minutes and checks its `.malini/widgets` folder every minute.
When a repository widget changes there, every board that shows it reads the new version at once, and the list under the board shows the new title.
Nobody presses anything.

## Make a widget

**New widget**, under the board, asks what the widget should show.
Return sends that prompt to the chat you are in, and ⌘Return sends it to a new chat in this workstream, while you stay where you are.
Every widget action that asks an agent works this way, as **Ship** and **Slice, fork, ship** do on a report's next steps.

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
		"http": {
			"url": "https://us.posthog.com/api/projects/12345/query/",
			"method": "POST",
			"headers": { "Authorization": "Bearer ${POSTHOG_KEY}" },
			"body": {
				"query": {
					"kind": "TrendsQuery",
					"series": [{ "kind": "EventsNode", "event": "$pageview" }],
					"dateRange": { "date_from": "-14d" }
				}
			},
			"keyUrl": "https://us.posthog.com/settings/user-api-keys"
		},
		"select": "{value: .results[0].count, unit: \"views\", chart: {kind: \"line\", labels: .results[0].labels, series: [{label: \"Views\", values: .results[0].data}]}}"
	},
	"refresh": { "every": 600 },
	"author": "your-login"
}
```

The source is one of two kinds:

- `http` sends one request to a service's own API, and `select` shapes the answer with jq.
  `method` is `GET`, the default, or `POST`, and a `POST` can carry a JSON `body`.
  The `url` is `https`, or `http` on your own Mac only.
  Malini follows no redirect, waits 20 seconds and reads 5 MB at most.
- `github` reads a GitHub API path with `gh api`, under your own sign-in, and `select` shapes the answer with jq.
  `{owner}` and `{repo}` are the repository's.

Widgets run no scripts and call no MCP tools.
A widget from an older Malini that runs a command or calls an MCP tool shows **Widgets read APIs now, not scripts or MCP tools.** until your agent moves it to an API.

### Keys

A key goes only in a header value, as `${NAME}`, the name of a [secret](/malini/docs/agent-tools.md#secrets).
The widget file holds the name, never the key, so a widget on the default branch is safe to share.
Each person saves their own key, and `keyUrl` is the page where they make one.

- Malini sends a key only to a site you allowed it for.
  A widget your agent saves allows its own site for the keys it names.
- A widget that names a key you did not save asks for it on the tile.
  **Save** keeps it in your keychain, for the repository, and allows the widget's site.
- A widget that sends a key you saved to a site you did not allow it for says so, and **Allow** with the site's name allows it.
  This is how a teammate's widget that sends your `POSTHOG_KEY` to another site gets nothing until you allow it.
- The key decides what the widget can do.
  Make a key that can only read, such as a PostHog personal API key with only `query:read`.
- Every error from a site shows the key as `[secret]`.

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
A repository widget reads what the default branch says, with your own keys and your own GitHub sign-in.
It reaches nothing but the site it names, or GitHub, as you.

### When a tile needs you

A widget that needs a key says which one, and the site Malini sends it to.

- **Needs POSTHOG_KEY**: paste the key in the tile's field and press **Save**.
  **Get a key** opens the widget's `keyUrl` in your browser.
- **POSTHOG_KEY is saved**: the key is in your keychain, but not for this site.
  **Allow us.posthog.com** sends it there from now on.

Once you save or allow the key, the tile reads at once.
A key you save in Settings, Secrets or on a chat's card reads the tile again too, and a key you delete there takes its numbers away.
A widget that still runs a script or calls an MCP tool shows no numbers, only that widgets read APIs now: ask the agent to move it to one.
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
