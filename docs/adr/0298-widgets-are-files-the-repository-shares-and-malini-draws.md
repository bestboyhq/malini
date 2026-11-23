# 0298 - Widgets are files the repository shares, and Malini draws them

Status: superseded by 0301

## Context

Simon asked for widgets in the right panel: "I would like my agent to be able to create custom widgets for me and I would like to be able to place those widgets there".
He picked a bento board because "it's the closest to what Apple did with widgets", where "the UI of every single widget will be responsive".
Of the Notes panel of 0277 he said "I don't think I'll ever click on notes".
0140 already holds that Malini draws every pixel, so an agent describes what to show and never ships HTML.
He wants widgets "shared with other people working on the same repository", yet "they shouldn't be automatically added to someone else ... but they should be suggested and maybe like half opaque", and "we shouldn't have tabs for widgets".
A widget that runs a command reads data on the user's Mac, so the user decides when it may run, the way they decide when a pull request merges.
The design went through a bento board, a Plan widget in four sizes and a suggestion stack before Simon picked the stack prototype.
This supersedes 0277.

## Decision

- A new `widgets` domain, `src/lib/widgets/`, with its renderer layers and `platform/`, seen through `widgets.api.ts` and `widgets.platform.ts`, and its contract in `src/contract/widgets.ts`.
- A widget is a JSON file, `.malini/widgets/<id>.json`, in the repository, so a widget reaches the team through the pull request that adds it.
  It names a title, an icon, a scope (`shared` or `own`), a source, a refresh (`every` seconds, 300 by default, 15 at least, and `on` Malini event channels), a default size and a URL.
  A source is `{ "github": "<gh api path>", "select": "<jq>" }` or `{ "command": "<shell command>" }`; the built-in `plan` widget has its own source, the repository's initiatives (0268).
- A source prints `WidgetData`, parsed by `parseWidgetData`: a value with a unit, caption and delta, a percent, a state with its history, rows, and a URL.
  Malini picks the drawing from the fields present and the tile's size, so a widget file carries no view.
- The board sits under the Changes and Browser card in the workstream's inspector, one per repository, with no tabs.
  Sizes copy iOS: small is one cell, medium two cells wide, large two by two, on a grid from `widgetGrid` in `widgets/domain/widget-grid.ts`.
  Click opens the widget's URL in a Browser tab, drag moves it, its corner resizes it, and **⋯** or a right-click opens its menu; nothing needs a double-click.
  The column widens from 288 to 620 pixels by dragging its left edge.
- Which widgets sit on your board, in which order and size, is yours alone, kept in SQLite with the last good reading of each.
  Every file you have not placed or hidden is a suggestion, faded in one stack card under the board with its author's GitHub avatar.
- Malini reads a widget in the main process only while a board that shows it is on screen and the window is visible, on its timer and on its `on` events.
  A `github` source runs `gh api --method GET` in the checkout and reads at once, a suggestion included.
  A `command` source runs in the checkout only once you place the widget, which approves the sha256 of its source; a changed source waits for **Allow**.
  A failed read keeps the last good data, dimmed, and the menu says when it last read.
- The agent makes a widget with the `widgets_save` MCP tool, which writes the file in the chat's worktree with your GitHub login as its author.
  It never runs a command source: the agent passes a `sample`, and the chat shows the widget in its three sizes with **Pin to my panel**.
- **Notes** leaves the inspector; the scratchpad stays on the repository page.

## Consequences

- A team shares a widget by merging a file, and every teammate sees it as a suggestion, never on their board unasked.
- A widget cannot draw anything Malini has no drawing for; a new shape of data needs a new drawing in `WidgetTile`.
- A command widget never runs before its user places it, and never runs a source they did not approve.
- `parseWidgetData` caps every text at 200 characters, rows at 50 and history at 30, and keeps only `http` and `https` URLs.
- Enforced by the `src/lib/widgets` unit tests (file parsing, approval by fingerprint, the reading cache), `tests/e2e/widgets.spec.ts` (suggestions, placing, a command source that runs only once placed, resize and remove, no Notes in the inspector) and `tests/e2e/widget-card.spec.ts` (the chat card pins a widget to the board).
