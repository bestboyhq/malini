# 0128 - Malini draws the variant switcher under the browser page

Status: accepted

## Context

Since #89 the agent instructions told every agent to give each HTML variant the same switcher, fixed at the bottom center of the page, and Malini had no code for it.
Agents wrote it by hand for each set, usually in a shared `shared.js` or `shared.css` the pages load, so it differed from set to set: one set left it unpinned, one page had none, and at a narrow inspector the badges set's bar wrapped and covered the page.
The browser cached worktree files, so a switcher added to that shared file after the page first loaded stayed missing until something busted the cache; agents loaded it as `shared.js?v=4` to get around that.
The user saw the switcher missing from time to time and asked whether it was robust.
A report already names its variants as `![Variant A: Name - note](path)` (0048), so Malini knows which pages belong together without the page saying so.

## Decision

- `offeredVariants` in `apps/malini/src/lib/chat/domain/turn-report.ts` reads the variants each turn's last report offered from the open chat's envelopes, oldest first, and `offeredVariantsQuery` gives them for the workstream that chat belongs to.
- `variantSwitcher` in `apps/malini/src/lib/browser/domain/variant-pages.ts` matches a tab's `malini-worktree://` page against the newest set that offers it: same path whatever the query, and the same fragment when the variant has one.
- `BrowserPanel.svelte` draws a **Variants** navigation under the page, outside it: **Previous variant**, each variant by letter and name with the shown one `aria-current="page"`, and **Next variant**; ← and → step while focus is in the strip, and the steps wrap around.
- `WorkstreamPage.svelte` passes the query to `browserTabPanels`, so the browser domain reads it without importing the chat domain.
- The instructions in `packages/agent-bridge/src/claude/instructions.ts` now ask for HTML variants embedded as their pages, each its own page or its own `#fragment`, never as screenshots, and never with a switcher built into the page.

## Consequences

- The switcher looks and works the same for every set, never covers the prototype, and needs no file the browser may have cached.
- It shows once the report lands; while the turn runs, the agent's pages have none.
- ← and → step only while focus is in the strip, so a page that uses arrow keys keeps them.
- A variant embedded as a screenshot gets no strip in the browser, which is why the instructions ask for the page.
- `variant-pages.test.ts` and `turn-report.test.ts` pin the matching and the reading, `instructions.test.ts` the instruction, and the e2e test "the browser puts a variants strip under a page the report offers and flips between the variants" in `tests/e2e/report-media.spec.ts` drives it through the fake bridge.
