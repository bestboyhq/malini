# 0083 - A chat's workstreams fold under it in the sidebar again

Status: accepted

## Context

0076 took every started workstream out from under the chat that started it, placed it under its repository, and listed a lead's work only at the top right of its page and in a hover card on its row.
Living with it, the user called that "a bad call": "if we have a chat on a repository level or … organization level or … global even, related work streams should be shown underneath in the sidebar. It should be possible to collapse them, but they should be there."
Since 0076 the sidebar also groups by Status or Day and sorts by Last active, Created or Name (#60, #62), so nesting has to hold in every arrangement, not only the default one 0070 knew.
This changes 0076's first decision line and its consequence that a workstream started by another workstream no longer nests; the rest of 0076 stands, including the top right list and the rule that a repository lists until you hide it.

## Decision

- `sidebarTree` (`src/lib/app/domain/sidebar-tree.ts`) nests per branch: the whole sidebar, or each Status or Day section.
  `nestStarted` moves a workstream under the listed workstream that started it, a Home chat, an organization chat or a repository workstream, at any depth, and each branch carries those children in `started`, a map from the starter's id.
- A workstream whose starter is not listed in the same branch, outside the focus, in another section, archived or in a hidden repository, stays under its repository.
  A `startedBy` cycle nests nothing, so no row ever drops out of the sidebar.
- Children sort like every other row: by the saved Manual order (`SidebarTreeInput.workstreamOrder`) across repositories, or by Last active, Created or Name.
  `branchWorkstreamIds` lists them right after their starter, so dragging and ⌥↑/⌥↓ move a child among its siblings.
- A repository keeps its row when all of its work is nested elsewhere, as 0076 decided; in a Status or Day section it lists only while it holds work of its own in that section.
- A nested row shows its repository's short name when it differs from its starter's, so a chat's children name the repository each one is in.
  The name hides on hover, like the change totals, so the row's buttons and its full-name tooltip have room.
- The starter's row gets a chevron, **Fold its workstreams** / **Show its workstreams**, that folds them; `collapsedGroupsStore` remembers it by the workstream's id, with the repository and owner folds.
- The progress dots, the hover card and the top right list from 0076 stay.
- The repository menu's **Remove** counts and retires every workstream of the repository, nested ones too, from the repository's full context rather than the rows under it.

## Consequences

- A chat's work is visible and foldable where the chat is, at every scope, and a repository workstream that starts work elsewhere shows it under itself again.
- A chat that started many workstreams grows a long row group until you fold it; the fold is per chat and survives a reload.
- In a Status or Day section a child sits under its starter only when both share the section, so a child that needs you still shows under **Needs you** when its chat is idle.
- Enforced by `sidebar-tree.test.ts` (nesting, focus, saved order, cycles, sections), `tests/e2e/lead-chats.spec.ts` (a Home chat's workstreams nest under it with their repository names, fold and stay folded after a reload) and `tests/e2e/agent-actions.spec.ts` (a workstream started from a repository workstream nests under it).
