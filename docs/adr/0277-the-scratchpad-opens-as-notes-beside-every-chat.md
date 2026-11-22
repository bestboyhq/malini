# 0277 - The scratchpad opens as Notes beside every chat

Status: superseded by 0286

## Context

0276 made every repository you open land in a workstream, so the repository page, the only home of the scratchpad (0019), is one click further away.
An idea comes up while you work in a chat, and writing it down meant leaving that chat.
Simon: "It would be really nice to have notes tab, and it would be a tab for repository scratch pad."
This amends 0019.

## Decision

- `scratchpadPanel` in `$lib/scratchpad` is a first-party inspector panel, `malini.notes`, labelled **Notes**, closed by default like every other panel.
  `WorkstreamPage` passes it as a built-in panel beside the browser tabs, so it is a row in the closed inspector and an entry in the panel picker.
- The panel mounts the same `Scratchpad` the repository page mounts, keyed by the workstream's `repositoryFullName`, so there is one scratchpad per repository and no second store.
- ⌘↵ on an idea runs `startWorkstreamFromNoteCommand`, which starts the workstream in the background and leaves you in the chat you are in.
- The inspector keeps a panel mounted per workstream, so several editors of one scratchpad can be alive at once.
  `ScratchpadEditor` now takes a changed `content` it did not write itself and shows it, so an older editor never saves stale text over a newer one.
- The scratchpad stays on the repository page, where it is also the root of the notes on outcomes and dependencies (0269).

## Consequences

- The scratchpad is reachable from every chat of its repository without a route change.
- The row shows no idea count; the sidebar's count on the repository still does.
- Enforced by `tests/e2e/scratchpad.spec.ts` (Notes keeps one scratchpad across two workstreams and the repository page, and moves an idea into a new workstream) and `tests/e2e/inspector-drawer.spec.ts` (the closed inspector lists Notes).
