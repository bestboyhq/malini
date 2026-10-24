# 0073 - Workstreams saved for later wait in their repository's scratchpad

Status: accepted

## Context

The only way to put a workstream aside was to archive it, and the user missed "a feature like save for later" next to the one that throws work away.
Archiving already loses nothing: the teardown keeps commits and uncommitted work under the archived snapshot ref, `.context` and agent attachments under `workstreams/.kept`, and every chat, and a restore brings them all back.
But **Recently archived** is one history sorted by date, where merged and unmerged workstreams mix and anything parked scrolls out of sight.
The user asked for the workstreams saved for later to be "included in the repository scratchpad", the page that already holds the ideas not started yet (0019).
`workstreams.status` has a `paused` value nothing writes, while more than a dozen places read "not archived" as "has a checkout".

## Decision

- Saving for later is archiving onto another shelf: `repositories.save-workstream-for-later` runs the archive teardown (`WorkstreamRetirement` `'saved-for-later'`) and sets `workstreams.saved_for_later` (migration v64), which `ArchivedWorkstreamDto.savedForLater` carries.
- The status stays `archived`, so the checkout checks, `repositories:workstream-removed` with `archived` set, the **A workstream is archived** trigger, the open pull request sync and the agent tools all treat a saved workstream as archived; `paused` stays unused.
- `repositories.archive-workstream` on a saved workstream only clears the flag, `repositories.save-workstream-for-later` on an archived one only sets it (`moveArchivedWorkstream`), and a restore clears it.
- Each repository workstream row in the sidebar has a clock button beside its archive button, `archiveWorkstreamCommand(workstream, announce, 'saved-for-later')`; chats at Home or an organization have no scratchpad and get none.
- `RepositoryPage` renders `SavedForLater.svelte` above the scratchpad: the repository's saved workstreams, newest first.
  A click resumes one through `restoreWorkstreamCommand`, and its archive button moves it to **Recently archived** through `archiveSavedWorkstreamCommand`.
- **Recently archived** leaves saved workstreams out, and a lead chat's started workstreams card labels them **Saved for later**.
- A repository stays in the sidebar while it holds a saved workstream, a local one too (`savedRepositoryIds` in `connectedRepositoryContexts` and `sidebarTree`), with a clock and the count on its row and "N workstreams saved for later" in its accessible description.

## Consequences

- Putting work aside and throwing it away are two buttons, and a saved workstream frees its checkout like an archived one; resuming it installs dependencies again, as a restore does.
- A saved workstream waits only on its repository's page: there is no reminder and no date to come back on.
- Workstreams archived before this stay in **Recently archived**; nothing moves them onto the shelf.
- Agents cannot save for later: `workstreams_archive` archives, and `workstreams_list` reports a saved workstream as archived.
- Enforced by `workstreams.test.ts` (saving, the move to the archive, the restore), `workstreams.repository.test.ts` (the flag through archive, move and restore), `repository-context.test.ts` and `sidebar-tree.test.ts` (a repository with saved work stays listed), `migrations.test.ts`, and `tests/e2e/save-for-later.spec.ts`.
