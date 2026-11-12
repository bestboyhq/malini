# 0237 - A workstream's live automations show in the closed inspector

Status: accepted

## Context

0168 put a workstream's live automations under **Automations (n)** above its composer, in the tray with the prompts you queued.
0228 starts the inspector closed, so the closed inspector beside the chat is what a workstream shows on the right: **Changes**, **Media**, **Browser** and the closed tabs.
Above the composer, a running automation sat under the queued prompts and scrolled with the tray, easy to miss.
In the user's words: "if some automations are running within context of a workstream, they should be visible in the right side gutter. Now they are bit too hidden".

## Decision

- `liveAutomationsHere` in `apps/malini/src/lib/automations/domain/live-automations.ts` picks what a workstream shows: every live automation in it, and what its chat started in another workstream.
- `workstreamLiveAutomationsQuery` in `automations/application/queries/` derives it once for the workstream page and the layout.
- `ExtensionGutter.svelte` takes a `footer` snippet under its rows, which `ExtensionInspectorShell` and `WorkstreamInspector` pass on as `gutterFooter`.
- `WorkstreamPage.svelte` fills it with `WorkstreamAutomationRuns ... inGutter` while the workstream has a live automation.
- `WorkstreamAutomationRuns` heads the list with a quiet **Automations** label, and drops the tray's scroll box in the gutter, whose own scroll holds it.
- While the inspector is open, the gutter is gone, and `WorkstreamLayout.svelte` puts the list back in the composer tray, as 0168 had it.
- A row names its state once, under that label: **Merge · Queued in Fetch command**, not **Merge · Automation in Fetch command**; its accessible name is unchanged.
- Kept from 0168: the order, what asks you first, then what runs, then the queue, oldest first, and the transcript a click away.

## Consequences

- A running automation shows beside the chat in the inspector's closed state, which a workstream starts in, without opening anything.
- The list shows in one place at a time, so the region **Automations (n)** is never on screen twice.
- `live-automations.test.ts` checks which entries `liveAutomationsHere` keeps for a workstream, with and without a chat.
- `tests/e2e/automations-in-chat.spec.ts` checks that a run waits in the closed inspector and not in the composer tray, moves to the tray when the inspector opens, and comes back when it closes.
- `tests/e2e/transcript-streaming-follow.spec.ts` opens the inspector before it checks an automation that leaves the composer tray.
