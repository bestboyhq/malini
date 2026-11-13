# 0237 - A workstream's live automations show under the inspector, not above the composer

Status: accepted

## Context

0168 put a workstream's live automations under **Automations (n)** above its composer, in the tray with the prompts you queued.
0228 starts the inspector closed, so the closed inspector beside the chat is what a workstream shows on the right: **Changes**, **Media**, **Browser** and the closed tabs.
Above the composer, a running automation sat under the queued prompts and scrolled with the tray, easy to miss.
In the user's words: "if some automations are running within context of a workstream, they should be visible in the right side gutter. Now they are bit too hidden".
A first cut moved the whole list there, with its **Run it** and **Skip** and every detail, and the user narrowed it: "just as a quick little rows. Openable oneliners, nothing else. only a small FYI for the user, nothing more".
A second cut kept the full list in the tray as well, and the user took it out: "automations shouldn't be part of composer in the center, they should be part of the right side panel".

## Decision

- The composer tray holds no automations: `WorkstreamAutomationRuns.svelte` and the `automations` snippet of `ChatSurface.svelte` are gone.
- Under the inspector, outside its card, Malini shows one line per live automation: the status icon, the automation's name and one word of state, such as **Running**, **Queued** or **Wants to run**.
  The user did not want them inside it: "we should not have those automations connected to the gutter. They should be just on the right".
- The lines show with the inspector closed or docked open, and hide while it floats over the chat in a narrow window, where they would sit under it.
- A line that asks you, a question or a run that waits to run, opens a popover under it with `AutomationQuestionRow`, the card that held **Run it**, **Skip** and the reconciler's choices in the tray.
- Any other line is a link: to the automation's transcript once it has one, and to the automation's page before that, where its recent runs carry **Cancel**.
- `AutomationGutterRows.svelte` draws the lines with `GUTTER_ROW_CLASS` from `$shared/extensions/inspector-gutter-row.ts`, the class `ExtensionGutter.svelte` gives its own rows.
- `ExtensionInspectorShell.svelte` renders a `belowGutter` snippet after its section unless the drawer floats, `WorkstreamInspector` passes it on, and `WorkstreamPage.svelte` fills it while the workstream has a live automation.
- `liveAutomationsHere` in `apps/malini/src/lib/automations/domain/live-automations.ts` picks what a workstream shows, every live automation in it and what its chat started elsewhere, through `workstreamLiveAutomationsQuery`.

## Consequences

- A running automation shows beside the chat without opening anything, and the composer keeps only what the chat itself does: queued prompts, background commands, changed files and requests.
- Answering a question takes one more click, on its line, and cancelling a queued run happens on its automation's page.
- In a narrow window with the inspector open over the chat, the lines hide; the top bar's **Automations** dot still counts what needs you.
- `live-automations.test.ts` checks which entries `liveAutomationsHere` keeps for a workstream, with and without a chat.
- `tests/e2e/automations-in-chat.spec.ts` checks that a queued run shows as a line and never in the composer tray, that the line opens its transcript once it runs, and that it goes once the run ends.
- `tests/e2e/automation-runs.spec.ts` and `tests/e2e/event-reconciler.spec.ts` answer **Run it**, **Skip** and the reconciler's choices from the line's popover, and `tests/e2e/automations.spec.ts` cancels a queued run from the automation its line opens.
