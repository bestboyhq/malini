# 0267 - Initiatives date outcomes, and workstreams serve their dependencies

Status: accepted

## Context

Workstreams answer what an agent works on, and the scratchpad (0019) holds raw ideas, but nothing in Malini held why: the outcome a week of workstreams is for.
The user asked for "a more advanced to-do list" and said Malini "shouldn't over-engineer it".
In their words: "I have some objective and I know what outcome I wanna have. I will have some dependencies for that outcome to happen and then to address the dependencies I will be clicking on that dependency and probably making a work stream from it and the outcome should be in calendar ... not work streams or tasks ... I will have loads of work streams every day".
An outcome often needs work in several repositories, such as a launch that needs `grip` and `platform`, so a per-repository page like the scratchpad cannot hold it.
They turned down attributing metrics to outcomes, "if the connection is not airtight, then we will be faking ourselves", and turned down a board, a metrics view and a calendar grid for the Rail, because "it's really simple".

## Decision

- A new `initiatives` domain, `src/lib/initiatives/`, with its renderer layers and `platform/`, seen through `initiatives.api.ts` and `initiatives.platform.ts`.
- An initiative is an outcome with a title and an optional due day, `YYYY-MM-DD` on the Mac's calendar.
  It has ordered dependencies, and a dependency has zero or more linked workstreams.
  Only initiatives carry a date, so the calendar stays quiet on a day with dozens of workstreams.
- Storage is three SQLite tables, `initiatives`, `initiative_dependencies` and `initiative_dependency_workstreams`, each deleted with its parent by `ON DELETE CASCADE`.
  A link keeps the workstream id only, so a deleted workstream leaves a link that no longer counts.
- `src/contract/initiatives.ts` declares eight commands, `initiatives.list`, `create`, `update`, `delete`, `add-dependency`, `update-dependency`, `delete-dependency` and `link-workstream`, and each returns the whole list.
  Titles are capped at `INITIATIVE_TITLE_MAX_LENGTH`, 300 characters.
  There are no events and no outbound calls.
- The main process adds each linked workstream's latest `Needs:` line to the list, read with `latestWorkstreamTurn` from `chat.platform.ts`.
- The renderer computes status live in `domain/initiative.ts`, from the same per-workstream standing that a chat's **Workstreams** card shows (0076).
  A dependency is done when every linked workstream that counts has merged.
  A workstream archived without a merge, or deleted, does not count.
  With no workstream that counts, the user ticks the dependency by hand, and the stored `done` flag holds that tick.
  An initiative is finished once it has dependencies and all of them are done.
- `/initiatives` is one page for every connected repository, opened from an **Initiatives** row below **New chat** in the sidebar, which counts the dependencies that need you.
  The page is the Rail: one row per day from today through the end of the week after next, further when an initiative is dated later, weeks labelled **Next week** and **Week of 30 Nov**.
  **Earlier** lists past-due initiatives that are not finished, and **No date** lists the undated ones.
- **Start workstream** on a dependency asks for the repository, unless only one is connected, starts a workstream in the background with the dependency as its first prompt plus the initiative's name and date, and links it.
- Dragging an initiative, or Alt+ArrowUp and Alt+ArrowDown, moves it to another day.
  A row's menu renames it, removes its date or deletes it.

## Consequences

- Outcomes and their progress sit in one place across repositories, and the sidebar points at the dependencies that wait on you.
- Progress is only what Malini can see for certain, merges and hand ticks, so the page never claims an outcome moved a metric.
- Initiatives live only in Malini's database on this Mac: not in git, not synced, gone with the profile, and there is no export.
- A workstream counts toward a dependency only through an explicit link; Malini never guesses which outcome a workstream serves.
- The status rule has one home, `domain/initiative.ts`, and the main process stores no derived status that could go stale.
- Enforced by `apps/malini/src/lib/initiatives/domain/initiative.test.ts` (the done rule, progress and the needs-you count, the Rail's days, weeks and **Earlier**), `apps/malini/src/lib/initiatives/platform/register.test.ts` (storage, validation and cascade deletes), `apps/malini/tests/e2e/initiatives.spec.ts` (the flow from naming an outcome to a linked workstream), and `@malini/desktop/domain-boundaries` lint (the slice's imports).
