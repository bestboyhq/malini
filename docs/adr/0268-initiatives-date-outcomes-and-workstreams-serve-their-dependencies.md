# 0268 - Initiatives date outcomes, and workstreams serve their dependencies

Status: accepted

## Context

Workstreams answer what an agent works on, and the scratchpad (0019) holds raw ideas, but nothing in Malini held why: the outcome a week of workstreams is for.
The user asked for "a more advanced to-do list" and said Malini "shouldn't over-engineer it".
In their words: "I have some objective and I know what outcome I wanna have. I will have some dependencies for that outcome to happen and then to address the dependencies I will be clicking on that dependency and probably making a work stream from it and the outcome should be in calendar ... not work streams or tasks ... I will have loads of work streams every day".
They turned down attributing metrics to outcomes, "if the connection is not airtight, then we will be faking ourselves", and turned down a board, a metrics view and a calendar grid for the Rail, because "it's really simple".
A first build put the initiatives of every repository on one `/initiatives` page, behind an **Initiatives** row in the sidebar that counted the dependencies that need you, and **Start workstream** asked for the repository.
The user turned it down: "I was expecting to have the regular planning view, but just filtered. And that's it."
The repository's page was its scratchpad (0019), with your open pull requests in a gutter on its right (0138), so the plan had no room there.
Of the pull requests they said "you will sometimes want it sometimes not ... it shouldn't be always visible in the UI".
A second build put **Scratchpad**, **Pull requests** and **Open on GitHub** in a header centered over the plan, with the scratchpad in a panel that opened from it.
The user asked for "a full-width top bar", the name as a link "with just open external arrow", **Pull requests** and **Saved for later** as hover cards, and the scratchpad "side by side with the list ... and a draggable handle for resizing in the middle between them".
This supersedes 0019 and 0138, and amends 0052, 0074 and 0198.

## Decision

- A new `initiatives` domain, `src/lib/initiatives/`, with its renderer layers and `platform/`, seen through `initiatives.api.ts` and `initiatives.platform.ts`.
- An initiative is an outcome with a title and an optional due day, `YYYY-MM-DD` on the Mac's calendar.
  It belongs to one repository, the one whose page it was named on.
  It has ordered dependencies, and a dependency has zero or more linked workstreams.
  Only initiatives carry a date, so the calendar stays quiet on a day with dozens of workstreams.
- Storage is three SQLite tables, `initiatives`, `initiative_dependencies` and `initiative_dependency_workstreams`, each deleted with its parent by `ON DELETE CASCADE`.
  Each `initiatives` row keeps the repository's full name in `repository_full_name`, which `Initiative` and `CreateInitiativeArgs` carry as `repositoryFullName`.
  A link keeps the workstream id only, so a deleted workstream leaves a link that no longer counts.
- `src/contract/initiatives.ts` declares eight commands, `initiatives.list`, `create`, `update`, `delete`, `add-dependency`, `update-dependency`, `delete-dependency` and `link-workstream`, and each returns the whole list.
  Titles are capped at `INITIATIVE_TITLE_MAX_LENGTH`, 300 characters, and `initiatives.create` refuses a missing repository name or one longer than `REPOSITORY_FULL_NAME_MAX_LENGTH`.
  There are no events and no outbound calls.
- The main process adds each linked workstream's latest `Needs:` line to the list, read with `latestWorkstreamTurn` from `chat.platform.ts`.
- The renderer computes status live in `domain/initiative.ts`, from the same per-workstream standing that a chat's **Workstreams** card shows (0076).
  A dependency is done when every linked workstream that counts has merged.
  A workstream archived without a merge, or deleted, does not count.
  With no workstream that counts, the user ticks the dependency by hand, and the stored `done` flag holds that tick.
  An initiative is finished once it has dependencies and all of them are done.
- `/repositories/:repositoryId`, `RepositoryPage.svelte`, opens on the repository's plan: the Rail, filtered to the initiatives of that repository.
  The Rail is one row per day from today through the end of the week after next, further when an initiative is dated later, weeks labelled **Next week** and **Week of 30 Nov**.
  **Earlier** lists past-due initiatives that are not finished, and **No date** lists the undated ones.
  There is no `/initiatives` page, and the sidebar has no **Initiatives** row and no count.
- **Start workstream** on a dependency starts a workstream at once, in the background, in the initiative's repository, with no repository picker.
  Its first prompt is the dependency plus the initiative's name and date, and the dependency links it.
- Dragging an initiative, or Alt+ArrowUp and Alt+ArrowDown, moves it to another day.
  A row's menu renames it, removes its date or deletes it.
- The repository's bar sits in the window's title row, in the band the chat tabs use, through `inGlobalTopBarBand` in `$shared/shell/global-topbar-actions.svelte.ts`.
  It shows the avatar, the owner, and the name as a link to the repository on GitHub with an external arrow, and it drops the **Open on GitHub** button.
  Outside the native shell the bar stays at the top of the page.
- The plan and the scratchpad sit side by side, the plan on the left, in a `ResizableSplit` whose handle drags, takes the arrow keys and resets on a double-click, and whose ratio persists under `scratchpad`.
  `primaryUnderSecondary={false}` puts the plan beside the scratchpad, not under it as the inspector's chat does.
- `SavedForLater.svelte` becomes a hover card in the bar, **Saved for later** with its count, shown only while a workstream waits there: it holds workstreams, not ideas.
  Everything else in 0019 still holds: one TipTap document per repository in `scratchpads`, keyed by the full name `COLLATE NOCASE`, and any paragraph moves into a new workstream in the background.
- Your open pull requests move into a hover card behind **Pull requests** in the bar, shown when the repository has a GitHub owner and its clone is ready.
  Hover opens a card, a click pins it, and Escape closes it, through `RepositoryBarCard.svelte` on hyper-ui's `HoverCard`.
  Everything else in 0138 still holds: Malini opens no workstream for a pull request on its own, the list comes from `repositories.list-own-pull-requests` without forks, and a pick runs `repositories.continue-own-pull-request`, which opens, restores or fast-forwards its workstream.
- Connecting a repository, and **Find a repository**, still open `/repositories/:repositoryId` before the clone finishes (0052, 0198), and land on its plan.
  The plan, like the scratchpad before it, needs only the connected repository row.

## Consequences

- A repository's page leads with the outcomes due from it by day, its ideas beside them, and its saved workstreams and pull requests one hover away.
- An outcome that needs work in two repositories is an initiative on each page, and no view shows every repository's initiatives at once.
- Nothing in the sidebar counts the dependencies that wait on you; a linked workstream that waits on you still shows it on its own sidebar row.
- Your saved workstreams and open pull requests no longer take room on the page while you do not need them, and the scratchpad trades width with the plan.
- Progress is only what Malini can see for certain, merges and hand ticks, so the page never claims an outcome moved a metric.
- Initiatives live only in Malini's database on this Mac: not in git, not synced, gone with the profile, and there is no export.
- A workstream counts toward a dependency only through an explicit link; Malini never guesses which outcome a workstream serves.
- The status rule has one home, `domain/initiative.ts`, and the main process stores no derived status that could go stale.
- Enforced by `apps/malini/src/lib/initiatives/domain/initiative.test.ts` (the done rule, progress, the Rail's days, weeks and **Earlier**), `apps/malini/src/lib/initiatives/platform/register.test.ts` (storage, the repository name, validation and cascade deletes), `apps/malini/tests/e2e/initiatives.spec.ts` (the flow from naming an outcome on a repository's page to a workstream linked in that repository), `apps/malini/tests/e2e/scratchpad.spec.ts` (the scratchpad beside the plan and its handle), `save-for-later.spec.ts` (saved workstreams in the **Saved for later** card), `open-on-github.spec.ts` (the name in the bar), `apps/malini/tests/e2e/clone-repository.spec.ts` (**Continue here** from **Pull requests**), and `@malini/desktop/domain-boundaries` lint (the slice's imports).
