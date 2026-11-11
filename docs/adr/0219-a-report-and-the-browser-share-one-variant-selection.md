# 0219 - A report and the browser share one variant selection

Status: accepted

## Context

A report shows its variants as tabs of one frame (0048), and since 0128 the browser draws a **Variants** strip under a page the report offers.
Each kept its own selection: the card held it in local state, and the strip read it from the tab's URL alone.
The user saw both pickers at once and found them out of step: "I would expect those pickers to be synchronized. Very important. So when I click a variant in the chat, my browser tab also gets switched variant."
The card lives in the chat domain and the strip in the browser domain, and neither may import the other (`@malini/desktop/domain-boundaries`).
The transcript window (0024) unmounts cards out of view, so a selection held only in a card is lost when it scrolls back.
This amends 0128: the strip still finds its variant from the tab's URL, and now the report reads and moves it too.

## Decision

- `variantChoices` in `apps/malini/src/lib/shared/variants/variant-choices.store.svelte.ts` is a flat shared store that both domains read and write.
  It keeps a revision per variant page, `worktreePageUrl(workstreamId, src)`, raised each time that page is chosen or shown, and a list of listeners for choices made in a report.
- `ReportStage.svelte` calls `variantChoices.choose` when the user clicks a variant's tab or moves to it with ← or →.
  An evidence tab, Before and after or a plain picture, stays local to the card and touches nothing in the browser.
- `TurnReportCard.svelte` selects the variant whose page has the newest revision, else the picked one, else the first, so the card and its **Go with** form follow the newest choice wherever it came from.
  An evidence tab stays shown only until a newer revision reaches one of the card's own pages, so the last action wins.
- `followChosenVariantsHook`, started in `AppShell.svelte`, listens for report choices.
  For every open tab of that workstream, `chosenVariantPage` in `browser/domain/variant-pages.ts` runs `variantSwitcher` against the card's set, and a tab on another page of that set navigates to the chosen page with `navigateBrowserCommand`; any other tab stays where it is.
- `BrowserPanel.svelte` calls `variantChoices.show` whenever the variant page its tab shows changes, whether the strip, its arrow keys, the agent's `browser_open` or a typed URL moved it, and while the page has not failed.
- `show` notifies no listener, so a browser page never navigates another tab, and the round trip of a report choice ends at the tab it moved.

## Consequences

- A card mounts, remounts and re-renders on the store's state and never navigates; only a click or an arrow key in a report does.
- A choice applies to every card whose variants include that page, so a later report that offers the same pages opens on the newest choice.
- A tab whose panel has never mounted has no known URL, so a report choice skips it, and when it loads it shows its remembered page and the report follows that page.
- Revisions live in memory per renderer and are lost when Malini restarts.
- `variant-pages.test.ts` pins `chosenVariantPage`, and the e2e test "a variant chosen in the report moves the browser to it, and a variant stepped in the browser is chosen in the report" in `tests/e2e/report-media.spec.ts` drives both directions through the fake bridge; "variants and the before and after share one frame, and the evidence keeps the chosen variant" pins the evidence tab.
