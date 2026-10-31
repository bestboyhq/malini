# 0133 - Merged work clears from Started here for good

Status: accepted

## Context

0132 lists every workstream a chat or a workstream started in **Started here**, open and archived, and the sidebar row draws a dot for each.
Merged work piles up there: a lead that shipped a dozen workstreams lists a dozen merged rows forever, and the user asked "is it possible to get rid of the merged ones thru ui for good?".
Deleting the workstream was the one removal the platform had (`repositories.delete-workstream` takes an archived workstream), but it erases the record, and `published-stats.ts` counts merges from those records, so a Bestboy profile and its share cards would lose them.
A prototype with **×** on a merged row and **Clear merged** on the heading was shown, and the user asked to build "Clear" for merged rows, saved for good.

## Decision

- A migration adds `workstreams.cleared_from_starter`, `0` or `1`, and `ArchivedWorkstreamDto` carries it as `clearedFromStarter`.
- `repositories.clear-merged-from-starter` takes `workstreamIds` and sets the flag in one transaction, only on rows that are archived and merged (`merged_pull_request_number IS NOT NULL`); any other id is ignored.
- `restoreWorkstreamRecord` resets the flag, so a restored workstream lists again, and archiving it later lists it too.
- `leadProgressQuery` leaves cleared workstreams out of `dots` and `startedIds`, so the list, the sidebar dots, the hover card and a lead's count drop them together; `cleared` counts them, and `leadHeadline` says **All merged** when everything a lead started was merged and cleared, where it said **No workstreams yet**.
- `StartedWorkstreams.svelte`, when it draws a `heading`, shows **×** on a merged archived row on hover or focus, and **Clear merged** in place of the count on the heading, both calling `clearMergedFromStarterCommand`.
  The transcript's **Workstreams** card keeps every row it names, since it records what a turn started.

## Consequences

- Clearing hides merged work without deleting it: it stays in **Recently archived**, in its pull request and in published stats.
- Nothing undoes a clear except restoring the workstream; there is no list of cleared work.
- Work that was archived without merging cannot be cleared and keeps its hollow dot.
- Enforced by `workstreams.repository.test.ts` ("clears only merged archived work from its starter, until it is restored"), `lead-progress.test.ts` (**All merged**), and the e2e test "a merged workstream a chat started opens its pull request from the number its row shows on hover" in `tests/e2e/merge-queue.spec.ts`, which clears the row, checks the dots, reloads, and finds it still cleared and still in **Recently archived**.
