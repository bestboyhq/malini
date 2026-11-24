# 0298 - Your widgets live in Malini, and the repository's come from its default branch

Status: accepted

## Context

0288 made every widget a file in a worktree, and 0291 kept three size presets on top of free spans.
Simon found the result confusing: a widget the agent made sat in the chat at three sizes, showed beside the board, and was not on it until **Pin to my panel**.
He asked for one rule: "if the widget is on the right, it's on the right. That's it. And it's persisted. And nobody should have to like pin it to the board".
He wants one size that lands "directly added to my widget panel right away to the top of it", and only two choices after that: "make this widget a default for this repo so other people can grab it or remove the widgets and that's it".
Repository widgets go "underboard, but only as I suggested to one click add", since "we should not force layout of the other people's boards".
A new widget is "something ephemeral that they just want to get into, do, and then get out", so it gets its own workstream.
And "whenever a shared widget is updated, it should just get automatically updated for everyone".
This supersedes 0291 and the parts of 0288 it names below.

## Decision

- A widget has an `origin`: `mine`, `shared` or `plan`.
- **Mine.**
  `widgets_save` writes the widget to `<appData>/widgets/<key>/mine/<id>/.malini/widgets/<id>.json`, where `<key>` is the first 24 hex characters of the sha256 of the board, the repository's full name in lower case.
  Helper files from the checkout's `.malini/widgets/` are copied beside it on each save, so the widget never depends on a worktree that gets archived.
  It is placed first on the board at `WIDGET_DEFAULT_SPAN`, 2 by 1, and read at once; nothing in the worktree changes.
- **Shared.**
  The repository's widgets are the `.malini/widgets` tree of `refs/remotes/origin/<default branch>` in the base clone, never a worktree's files.
  `sharedTree` in `widgets/platform/widget-store.ts` names that tree, and `materializeShared` copies it once per tree to `<key>/shared/<tree>/`, where its commands run.
  A shared id wins over a mine id, and `widgets_save` refuses a shared id.
- **Auto-update.**
  The base clone is fetched as before, every five minutes.
  While a board is watched, `WidgetBoards` checks `sharedTree` every `SHARED_CHECK_MS`, 60 seconds, and a new tree re-plans the board and reads each placed shared widget at once.
  `MALINI_WIDGETS_CHECK_MS` shortens that check in an unpackaged build, for the e2e harness.
- **Placement is approval.**
  The migration at user version 120 drops `widget_hidden` and `widget_placements.approved_fingerprint`.
  A placed widget runs whatever source its origin holds now, so a merged change to a shared command runs on every board that shows it, with no **Allow**.
  A command runs with the widget's own folder as its working directory, the repository's secrets in its environment and `MALINI_CHECKOUT` set to the workstream's checkout.
- **One click.**
  `WidgetShelf` lists, under the board, the shared widgets that are not placed, with **Add**, which places one first.
  **Remove** unplaces a shared widget, which goes back to the shelf, and deletes a mine widget with its reading.
- **Make default.**
  A mine widget's menu has **Make default for this repository**: `makeWidgetDefaultCommand` starts a background workstream, `widgets.share` copies the widget file and its helpers into that worktree's `.malini/widgets/` once `repositories:workstream-created` arrives, and the first prompt asks the agent there to check them for secrets and open a draft pull request.
- **New widget.**
  **New widget** under the board asks what it should show, and Return starts a workstream of the repository with that prompt.
- **One size.**
  The presets, `size` in a widget file and in `widgets_save`, `sample`, and the chat's three-size card go.
  A widget file may still carry `size`, and the parser ignores it.
  The plan starts at `PLAN_WIDGET_SPAN`, 12 by 2.
  The chat card shows the tile at its size on the board, with the board's columns and cell, with **On your board** and **Remove**.
- **Moving.**
  The dragged tile follows the pointer while an outline shows its landing slot, the drop saves at once, and the glide to the slot is only visual.
- A placed id whose file is only in the checkout, from before this change, is copied into the mine store once.
- Everything else in 0288 and 0291 stands: files and their `WidgetData`, the board under the inspector's card, private placements, reading only while a board is visible, and spans of whole cells.

## Consequences

- What is on the board is saved, and the chat and the board can no longer disagree.
- A widget outlives the workstream that made it, and sharing it is a pull request the agent opens for you.
- A teammate's merged change reaches every board within about six minutes, with nobody pressing anything.
- A shared command is now as trusted as any script on the default branch: whoever can merge there can run a command on every Mac that placed the widget.
- Enforced by `src/lib/widgets/platform/register.test.ts` on real SQLite and git (the mine store, helpers and `MALINI_CHECKOUT`, the refused shared id, placement and removal, the shared update reaching a placed widget, make default), `src/main/db/migrations.test.ts`, `tests/e2e/widgets.spec.ts` (the shelf, Add, drag, Alt and an arrow, the corner, Remove, and a change on main reaching the shelf), `tests/e2e/widget-card.spec.ts` and the widget case of `tests/e2e/agent-actions.spec.ts`.
