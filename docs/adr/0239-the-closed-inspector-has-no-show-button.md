# 0239 - The closed inspector has no Show inspector button

Status: accepted

## Context

0228 starts the inspector closed, with **Changes**, **Media**, **Browser** and the workstream's tabs as rows that each open it on what they name.
It kept a **Show inspector** chevron above those rows, from the drawer before 0228, which opened the inspector on the tab you had.
The rows and the reveals already open the inspector when there is something to show: an agent's page holds it open (`openForPanel`), and a folded drawer unfolds once a panel comes back (`unfold`).
In the user's words: "in this right panel we have icon button for showing the inspector or whatever. Just delete it. We shouldn't have it there. We should have only changes, media and browser", and it is "a leftover from our previous implementation".

## Decision

- `ExtensionGutter.svelte` drops its `onshow` prop and the **Show inspector** button, so the closed inspector holds only its rows.
- `InspectorDrawer.toggle`, which nothing called, goes too.
- The inspector opens from a row, from an agent's reveal, or by unfolding, as 0228 has it; **Hide inspector** still closes it.
- `showInspector` in `apps/malini/tests/e2e/harness.ts` opens it the way a user now does: **Changes**, then **Remove the changed files filter**.

## Consequences

- Seeing every file takes the **Changes** row and one click on the filter chip.
- `tests/e2e/inspector-drawer.spec.ts` ("the inspector starts closed, its Changes row opens Files on the changed files, and each workstream keeps its own drawer, files and picked tab") checks that the closed inspector holds only **Changes** and **Browser** in a workstream with no media, and that the filter chip shows every file.
