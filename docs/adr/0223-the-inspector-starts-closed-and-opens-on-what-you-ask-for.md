# 0223 - The inspector starts closed and opens on what you ask for

Status: accepted

## Context

Every workstream opened with the inspector showing the whole Files tree, because a workstream with no saved drawer state counted as open.
No ADR gave a reason for that default.
The user said Malini assumed people want to see their files all the time, which is rarely the case, and that it breaks progressive disclosure: "show them only what they care about".
They asked for the inspector to stop showing files by default, for its closed list to call the Files row **Changes** with a plus and minus icon, and for that row to open Files with the changed files filter on.
They also asked agents to close the browser tabs they open (ADR 0220), which only helps the user if a tab the agent opened can take the inspector back when it goes.

## Decision

- A workstream with no saved drawer state starts closed: `loadInspectorDrawerOpen` in `apps/malini/src/lib/shared/extensions/inspector-drawer.store.svelte.ts` is true only for a saved `open`.
  Closing a drawer that was never opened writes nothing, and opening it writes `open` under `malini.extensions.inspector-drawer-v1:<workstreamId>` as before.
- Closed, the inspector is the gutter it already folded to: `gutterRows` in `apps/malini/src/lib/shared/extensions/inspector-gutter-row.ts` names the Repository extension's Files row **Changes**, with the `changes` icon (the `diff` glyph) and the workstream's line totals, and pins it first.
- Clicking **Changes** runs the Repository extension's new `malini.repository.show-changed-files` command, then opens Files.
  The Changed filter moved from a field of the panel view into the controller's `RepositoryViewState.changedOnly`, so a command can turn it on before the panel mounts, and each workstream remembers its own filter.
- A gutter row can also be an action with a count: an `InspectorPanelAction` with `count` above zero shows under **Changes** (the Media gallery, ADR 0224, uses it), and every action still shows in the panel picker.
- A tab revealed for an agent (`inspectorPanelCommands.reveal`, from `browser:tab-opened`) opens a closed drawer through `InspectorDrawer.openForPanel`, held in memory and never saved.
  When that panel leaves the inspector, from the agent's `browser_close` or the user's ×, the hold ends and the drawer closes again.
  Any user action on the drawer while it is held (clicking a tab, Show inspector, Hide inspector, opening a panel) ends the hold the user's way: open and saved, or closed.
- The narrow window's overlay drawer is unchanged: it never opens on its own.

## Consequences

A new workstream shows the chat and a short list, and Files appears only when the user or an agent asks for it.
An agent's page still shows up for the user, and goes away with it, so the agent can show a page and put it away without leaving the inspector open behind it.
Tests that need the inspector open now open it the way a user does, through `showInspector` in `apps/malini/tests/e2e/harness.ts`.
`inspector-drawer.store.svelte.test.ts` covers the closed default and the hold, `inspector-gutter-row.test.ts` the Changes row and action rows, `extensions/repository/tests/panel.test.ts` a Files panel that mounts with the filter already on, and `apps/malini/tests/e2e/inspector-drawer.spec.ts` and `browser-tab.spec.ts` the flow in the app.
