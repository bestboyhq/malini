---
title: Initiatives
description: An initiative is an outcome with the day you want it and the dependencies it needs, each served by workstreams, on its repository's page.
---

You start loads of workstreams a day.
None of them says what it is for.
An initiative does: one outcome, the day you want it, and what has to happen first.

## What an initiative is

An initiative is an outcome, such as "Launch the new pricing", with an optional due day.
It has dependencies, in the order you add them: what has to happen for the outcome to happen.
A dependency has zero or more workstreams linked to it.

Only initiatives carry a date.
Workstreams and dependencies never land on a day, so a day with dozens of workstreams still shows one or two lines.

An initiative belongs to the repository whose page you name it on.
A launch that needs work in `grip` and `platform` gets an initiative on each page.

Raw ideas still go on a repository's [scratchpad](/malini/docs/workstreams.md#the-sidebar).
An initiative is for an outcome you already know you want.

## The day rail

A repository's page opens on its plan: the day rail, with only that repository's initiatives.
Click the repository in the sidebar to get there.

The rail is one row per day, from today through the end of the week after next.
An initiative dated later stretches the rail to its week.
The weeks after this one read **Next week**, then **Week of 30 Nov**.
**Earlier** lists the initiatives whose day has passed and that are not finished.
**No date** lists the ones without a day.

Name an outcome on a day to add an initiative there.
Its dependencies show under it, and the arrow at the end of its row hides them.

## Dependencies and when they are done

Add dependencies under an initiative.
A dependency is done by one rule:

- With no linked workstream, you tick it by hand.
- With linked workstreams, it is done once every one of them has merged.
  Until then it shows the workstream that needs the most from you: waiting on you, failed, running, then idle.
- A workstream archived without a merge, or deleted, stops counting.
  When none is left, the tick is yours again.

A linked workstream that waits on you shows its last `Needs:` line.
Malini reads each workstream's state live, the way a chat's **Workstreams** card does, so a merge shows as soon as it lands.

An initiative counts its finished dependencies, and it is finished once all of them are done.
A finished initiative leaves the rail once its day has passed.

## Sync with GitHub

A plan lives on your Mac until you turn on **Sync with GitHub**, in the plan's header or the [Plan widget](/malini/docs/widgets.md#the-plan-widget).
Sync is per repository and off until you turn it on.

- Each outcome becomes a milestone, with its day as the due date and its note as the description.
- Each dependency becomes an issue in that milestone, with its note as the body, and a closed issue means done.
- The issue's assignee shows as their GitHub picture on the dependency.
- When a linked workstream's pull request merges, Malini closes its issue.
- A milestone or issue someone adds on GitHub joins the plan, and one they delete leaves it.
  Deleting a dependency in Malini closes its issue, since GitHub keeps issues.

Malini reads GitHub every 30 seconds while the plan is on screen, and writes after each edit.
A change someone else made shows as a line at the bottom of the window, such as who closed which issue.
Everyone with access to the repository sees the milestones and issues, people without Malini included.
The scratchpad stays on your Mac.

Turning sync off stops it and leaves GitHub as it is.

## Notes

Click an initiative or a dependency to select it.
The pane beside the plan then shows its note in place of the scratchpad, and what you write there stays with that row.
A row with a note shows a small note mark.
**Scratchpad** above the note goes back to the scratchpad, and from a dependency's note the initiative's name opens the initiative's note.
Deleting a row deletes its note.

## Start workstream

The send button on a dependency, **Start workstream**, starts a workstream for it in the background, in the initiative's repository, and links it.
The first prompt is the dependency, with the initiative's name and date, so the agent knows what the work is for.
Nothing opens, so you can start the next one right away.

## Move and edit

Drag an initiative to another day, or press **⌥↑** and **⌥↓**.
Click a title to edit it in place: Return saves, Escape drops the edit.
A row's menu renames it, removes its date, or deletes it.
Deleting an initiative deletes its dependencies and their links, and keeps the workstreams.

## Where it lives

Initiatives live in Malini's database on this computer, each under its repository's full name.
They are not in git, they do not sync, and nothing about them leaves the Mac.
