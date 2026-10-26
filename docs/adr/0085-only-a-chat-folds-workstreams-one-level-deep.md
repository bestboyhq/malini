# 0085 - Only a chat folds workstreams under it, one level deep

Status: accepted

## Context

0083 nested a workstream under the listed chat or workstream that started it, at any depth.
In the user's sidebar, a Home chat held a workstream that held another workstream two levels down, and the user called it "really weird when workstream can have a subworkstream".
A workstream is one branch in one repository, not a place work hangs from; a chat at Home or in an organization is.
This changes 0083's first decision line and its consequence that a repository workstream that starts work shows it under itself; the rest of 0083 stands.

## Decision

- Only a chat at Home or in an organization, a workstream whose `scope` is set, holds rows in the sidebar.
- `sidebarTree` (`src/lib/app/domain/sidebar-tree.ts`) follows each repository workstream's `startedBy` chain, through every workstream Malini lists, to the first chat in it, and `nestStarted` puts the workstream directly under that chat when the chat is listed in the same branch.
  Work a chat's workstreams start in turn sits beside them, one level under the chat.
- A workstream whose chain reaches no listed chat, because no chat started it, the chain passes an archived workstream, or the chat is out of the pin or the section, stays under its repository.
  A `startedBy` cycle reaches no chat.
- The progress dots stay on the row of the workstream that started the work, and its hover card and top right list stay too.
- `Sidebar.svelte` indents three levels at most, and a nested row always names its repository.

## Consequences

- No workstream row ever holds another, so the sidebar is at most chat, then its work.
- A chat's whole lineage of work folds under its chevron, even work started two hops away.
- Which workstream started which shows only through the dots and the top right list, no longer through indentation.
- Enforced by `sidebar-tree.test.ts` (a chat's grandchild sits beside its child; a repository workstream's work stays under its repository) and `tests/e2e/agent-actions.spec.ts` (a workstream started from a repository workstream lists under its repository, with no **Started by** list).
