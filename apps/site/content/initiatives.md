---
title: Initiatives
description: An initiative is an outcome with the day you want it and the dependencies it needs, each served by workstreams, on one page for every repository.
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

One page holds the initiatives of every repository you connect.
A launch that needs work in `grip` and `platform` is one initiative, with a workstream in each.

Raw ideas still go on a repository's [scratchpad](/malini/docs/workstreams.md#the-sidebar).
An initiative is for an outcome you already know you want.

## The day rail

**Initiatives**, below **New chat** in the sidebar, opens the page.
Its count is the number of dependencies with a workstream that waits on you.

The page is one row per day, from today through the end of the week after next.
An initiative dated later stretches the rail to its week.
The weeks after this one read **Next week**, then **Week of 30 Nov**.
**Earlier** lists the initiatives whose day has passed and that are not finished.
**No date** lists the ones without a day.

Name an outcome on a day to add an initiative there, and click it to open it.

## Dependencies and when they are done

Add dependencies to an open initiative.
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

## Start workstream

**Start workstream** on a dependency starts a workstream for it in the background and links it.
With more than one repository in the sidebar, it asks which one first, and hidden repositories stay out of the list.
The first prompt is the dependency, with the initiative's name and date, so the agent knows what the work is for.
Nothing opens, so you can start the next one right away.

## Move and edit

Drag an initiative to another day, or press **⌥↑** and **⌥↓**.
A row's menu renames it, removes its date, or deletes it.
Deleting an initiative deletes its dependencies and their links, and keeps the workstreams.

## Where it lives

Initiatives live in Malini's database on this Mac.
They are not in git, they do not sync, and nothing about them leaves the Mac.
