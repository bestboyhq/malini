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

Name an outcome on a day and press Return to add an initiative there.
The field stays, so you can type the next outcome right away.
The **+** at the end of a row adds a dependency to it: Return adds each one, and Escape goes back to the outcome.
Its dependencies show under it, and the arrow at the end of its row hides them.

## Dependencies and when they are done

Add dependencies with the **+** on an initiative's row.
A dependency is done by one rule:

- With no linked workstream, you tick it by hand.
- With linked workstreams, it is done once every one of them has merged.
  Until then it shows the workstream that needs the most from you: waiting on you, failed, running, then idle.
- A workstream archived without a merge, or deleted, stops counting.
  When none is left, the tick is yours again.

A linked workstream that waits on you shows its last `Needs:` line.
Malini reads each workstream's state live, the way a chat's **Workstreams** card does, so a merge shows as soon as it lands.

An initiative counts its finished dependencies, and it is finished once all of them are done.
Tick the circle beside an initiative to finish it yourself, and tick it again to undo it.
An initiative whose dependencies are all done shows a full circle that no tick undoes.
A finished initiative is struck through, and it leaves the rail once its day has passed.

## Share internally

A plan lives on your Mac until you turn on **Share internally**, in the repository page's top bar or the [Plan widget](/malini/docs/widgets.md#the-plan-widget).
Hover it to see where the plan goes and who sees it.
Once it is shared, the top bar shows the people who edited the plan beside the switch.
Sharing is per repository and off until you turn it on.

A shared plan never goes into the repository itself.
It goes to a private repository of its own, named after it with `-malini-plan`, such as `acme/web-malini-plan`, whether `acme/web` is public or private.
So a private repository that turns public later takes no plan with it.

- Turning sharing on makes the plan repository when it is not there yet.
  In a repository of another person's account, only they can make it, so Malini asks them for you.
- The plan is one file, `plan.json`, on `main`.
  Each change is a commit that names it, such as `Rename Launch`, so the plan's history is the repository's history.
- Malini fetches, merges and pushes the file with git.
  Two people who edit different fields both keep their edit, and a deleted row stays deleted.
  Anyone can edit the file by hand, and Malini drops what it cannot read.
- When a linked workstream's pull request merges, Malini ticks its dependency.
- The tick on an initiative goes in the file too.

Only collaborators of the code repository see the plan.
When you can manage the plan repository, Malini keeps its people in step with the code repository: it invites new collaborators with the access they have there, removes people who left, and cancels invitations they no longer need.
It checks at most every 10 minutes while sharing is on.
Malini checks that the plan repository is still private before each sync, and turns sharing off once it is public or gone.

Malini syncs every 30 seconds while the plan is on screen, and after each edit.
A change someone else pushed shows as a line at the bottom of the window, such as who closed which initiative or dependency.
The scratchpad stays on your Mac.

Turning sharing off stops it, and the plan repository keeps its file and history.

### Ask the owner

When only the owner can make the plan repository, turning sharing on asks their Malini instead, and the switch reads **Asked** and their login, such as **Asked casey**.
The ask is a hidden git ref in the code repository, `refs/malini/plan-requests/<your login>`, which names who asked and holds no plan.
No clone, branch list or pull request shows it.

The owner's Malini looks for asks at launch, every 10 minutes and each time its window loads, in every GitHub repository it lists whose plan is not shared.
When they are an admin of that repository, a toast says who wants to share the plan and who would see it, with **Share** and **Not now**.

- **Share** turns sharing on, invites you, deletes the ask and puts the Plan widget first on their board.
- **Not now** keeps the toast away, and a dot beside their switch stays until they share.

Your Malini then accepts the invitation to that one plan repository by itself, turns sharing on and tells you the owner said yes.
It accepts no other invitation.
Turning your switch off while you wait takes the ask back.
The owner sees nothing until they run Malini.

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
**↑** and **↓** move between titles.
A row's menu renames it, removes its date, or deletes it.
Deleting an initiative deletes its dependencies and their links, and keeps the workstreams.

## Where it lives

Initiatives live in Malini's database on this Mac, each under its repository's full name.
Until you turn on **Share internally**, they are not in git, they do not sync, and nothing about them leaves the Mac.
