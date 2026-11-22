# 0287 - A plan syncs with GitHub milestones and issues

Status: accepted

## Context

0268 keeps a repository's plan, its dated outcomes and their dependencies, in Malini's SQLite on one Mac.
Simon asked "can we Also synchronize list of outcomes ... and the dependencies", with "a widget for modifying those", for a game he builds with a friend: "outcomes or goals or dependencies that we could just see directly in Malini".
Malini has no backend (`AGENTS.md`), and everything on GitHub goes through the `gh` CLI, so the team's copy has to live on GitHub.
Milestones already carry a title, a due date and a description, and issues already carry a title, an open or closed state, a body and assignees.
Syncing puts the plan where everyone with access to the repository reads it, so it is a choice per repository and never a default.

## Decision

- `initiatives.set-sync` turns sync on or off for one repository; it is off by default and kept in SQLite, and `initiatives.sync-state` reports it with the last sync, its error and the GitHub logins seen.
- With sync on, each outcome is a milestone: its title, its due day as `due_on`, and its note as the description.
  Each dependency is an issue in that milestone: its title, closed when done, its note as the body, and its first assignee shown as an avatar.
- `initiatives.sync` pulls milestones and issues with `gh api`, applies only the fields that changed on GitHub since the last sync, then pushes only the fields that changed in Malini.
  The last synced values of each row are kept in SQLite, so a pulled value is never pushed back.
  A milestone or issue made on GitHub joins the plan, and one deleted there leaves it.
  Deleting an outcome deletes its milestone, and deleting a dependency closes its issue, since an issue cannot be deleted.
- Every edit command pushes in the background when sync is on and returns at once; a failed push stays in the sync state and retries at the next sync.
- A dependency whose linked workstream merged closes its issue.
- The renderer calls `initiatives.sync` every 30 seconds while a plan is on screen, on the repository page or in the Plan widget, and once when the window shows again.
  `initiatives:synced` carries the changes other people made, and each one shows as a toast.
- The scratchpad never leaves the Mac; a note on an outcome or a dependency goes up as plain text.

## Consequences

- A team shares one plan with no server of Malini's: GitHub holds it, and people without Malini work on it as milestones and issues.
- Turning sync off stops it and leaves GitHub as it is.
- Sync makes no outbound call of its own: every call goes through `gh`, under the user's own GitHub sign-in.
- Enforced by `src/lib/initiatives/platform` tests on real SQLite with a fake `gh` (a first sync both ways, a remote close and reopen, a rename, a due day round trip, a remote delete, a merge that closes its issue, a sync that changes nothing writes nothing, and no call while sync is off).
