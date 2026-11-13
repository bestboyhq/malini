# 0237 - A workstream's live automations show under the closed inspector

Status: accepted

## Context

0168 put a workstream's live automations under **Automations (n)** above its composer, in the tray with the prompts you queued.
0228 starts the inspector closed, so the closed inspector beside the chat is what a workstream shows on the right: **Changes**, **Media**, **Browser** and the closed tabs.
Above the composer, a running automation sat under the queued prompts and scrolled with the tray, easy to miss.
In the user's words: "if some automations are running within context of a workstream, they should be visible in the right side gutter. Now they are bit too hidden".
A first cut moved the whole list there, with its **Run it** and **Skip** and every detail, and the user narrowed it: "just as a quick little rows. Openable oneliners, nothing else. only a small FYI for the user, nothing more".

## Decision

- The composer tray keeps the full list, as 0168 has it.
- Under the closed inspector, outside its card, Malini adds one line per live automation: the status icon, the automation's name and one word of state, such as **Running**, **Queued** or **Wants to run**.
  The user did not want them inside it: "we should not have those automations connected to the gutter. They should be just on the right".
- A line opens the automation's transcript once it has one, and otherwise the chat where its row waits, as `AutomationQuestionLink` does.
- `AutomationGutterRows.svelte` draws the lines with `GUTTER_ROW_CLASS` from `$shared/extensions/inspector-gutter-row.ts`, the class `ExtensionGutter.svelte` gives its own rows.
- `ExtensionInspectorShell.svelte` renders a `belowGutter` snippet after its section while the drawer is closed, `WorkstreamInspector` passes it on, and `WorkstreamPage.svelte` fills it while the workstream has a live automation.
- `liveAutomationsHere` in `apps/malini/src/lib/automations/domain/live-automations.ts` picks what a workstream shows, every live automation in it and what its chat started elsewhere, and `workstreamLiveAutomationsQuery` hands the same list to the tray and the gutter.

## Consequences

- A running automation shows beside the chat while the inspector is closed, which a workstream starts in, without opening anything.
- The gutter only points: deciding, cancelling and the details stay in the tray, so the two never drift apart.
- An open inspector hides the lines, and the tray still shows everything.
- `live-automations.test.ts` checks which entries `liveAutomationsHere` keeps for a workstream, with and without a chat.
- `tests/e2e/automations-in-chat.spec.ts` checks that a queued run shows as a line outside the inspector's region, that the line opens its transcript once it runs, and that the line goes once the run ends.
