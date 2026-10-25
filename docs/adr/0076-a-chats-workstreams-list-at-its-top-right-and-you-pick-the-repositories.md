# 0076 - A chat's workstreams list at its top right, and you pick the repositories the sidebar lists

Status: accepted

## Context

0070 folded every workstream under the chat that started it, so a lead's sidebar row grew a list of every repository it touched, and it listed a repository only while it held work of its own or was open; 0074 added a repository holding work saved for later.
The user asked that a chat with workstreams "shouldn't have them in a sidebar as a list, but top right corner of a chat", where the top bar already counts them ("13 of 16 merged"), and that the chat's row keep its progress dots: "dots on the chat item are awesome and already quite telling, chat item shouldn't change".
They also found it "annoying inactive repos are hidden w/o way to change it" and asked to "chose myself repos i'd see and repos i wouldn't".
Hiding a repository already existed (`hidden_repositories`, **Hide** in its right-click menu, **Unhide** on the repository list), but the activity rule hid every quiet repository on top of it.
This changes 0070's sidebar and top bar lines and 0074's sidebar line; the rest of both stands.

## Decision

- `sidebarTree` (`src/lib/app/domain/sidebar-tree.ts`) places every workstream under its repository and folds nothing under the workstream that started it; `startedBy` no longer shapes the sidebar.
- A lead's sidebar row keeps its progress dots and count from `leadProgressQuery.dots`, and `leadProgressQuery.startedIds` lists its started workstreams.
- On a lead's page the list of its started workstreams, open and archived, stays open at the top right under the headline, in the dock the lead's inspector leaves empty: `WorkstreamPage` passes a `dock` snippet to `WorkstreamInspector`, which draws it in a card that claims the dock (`dockInspector(true)`), so the top bar card opens into it the way it opens into the Files panel.
  The user asked for it "always rendered, not on toggle".
- Each row shows the state glyph, the repository's avatar and short name, and the state pill; the user said there is "no need for repo name and chat name" on every row, so the owner and the workstream's chat name live only in its accessible name.
  The transcript's **Workstreams** card draws the same rows (`StartedWorkstreams.svelte`, `framed`).
- A repository lists in the sidebar while it is not hidden and fits the focus, whether or not it holds work; `hidden_repositories` is the only choice, and `SidebarTreeInput` loses `openRepositoryId` and `savedRepositoryIds`.

## Consequences

- The sidebar is one level of workstreams per repository, and a lead's work stays in view at the top right of its page instead of a nested list.
- Someone with many connected repositories sees all of them until they hide the ones they do not want; there is no automatic tidying.
- A workstream started by another repository workstream no longer nests under it either; its **Started by** header and the starting chat's transcript card still link the two.
- Enforced by `sidebar-tree.test.ts` (no nesting, an unhidden repository without work lists, a hidden one does not), `tests/e2e/lead-chats.spec.ts` (the lead's page lists its workstreams at the top right and a row opens one) and `tests/e2e/hide-repository.spec.ts`.
