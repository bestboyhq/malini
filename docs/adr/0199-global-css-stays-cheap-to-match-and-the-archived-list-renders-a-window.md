# 0199 - Global CSS stays cheap to match and the archived list renders a window

Status: accepted

## Context

The user reported that Malini starts to drop frames after it runs for some time.
On a copy of their profile, every full style pass on a long chat took 46 ms, and the live app took 55 to 65 ms for each forced style and layout pass.
The sidebar's Archived section rendered all 558 archived workstreams, 70% of the page's elements, and it grows with every archive.
Chrome's selector stats over five full style passes put 39% of the matching time on `hover-feedback.css`'s `:hover *` rules, 28% on daisyUI component rules and 11% on the extension panel kit's box-sizing reset.
Tailwind 4 emits a daisyUI component as soon as its name appears as a word in the source, so `.dock`, `.menu` and 37 others shipped although the app uses none, and daisyUI's `.skeleton` and `.swap` leaked into hyper-ui's `Skeleton` and the next-steps tray's own classes.
A rule whose rightmost part is `*`, or a `:where()` or `:is()` that names no class, tag or id, is tried on every element and walks its ancestors, so its cost grows with the page.

## Decision

- `apps/malini/src/renderer/src/app.css` loads daisyUI with `include: properties`, as the site has since 0034; themes still come from `daisyui/theme` in hyper-ui.
- `packages/hyper-ui/src/styles/components/hover-feedback.css` makes transitions instant on the hovered control and on the descendants whose class names a transition, `:where([class*='transition'])`, instead of on every descendant; its specificity stays `(0,2,0)`.
- `packages/extension-api/src/panel-styles.ts` drops the panel kit's box-sizing reset, since every document a panel mounts in loads Tailwind preflight, which already sets `border-box`.
- No global rule ends in `*`, or in a `:where()` or `:is()` that names no class, tag or id, when a narrower selector does the same job.
- The Archived list renders only the rows in view and eight rows above and below them, from `archivedRowWindow` in `apps/malini/src/lib/app/domain/sidebar-archived.ts`; padding stands in for the rest, and each row carries `aria-setsize` and `aria-posinset`.

## Consequences

- On that chat, the page drops from 9,410 to 2,759 elements and a full style pass from 46 ms to 8.6 ms; eight routes capture pixel for pixel the same as before.
- A transition declared in component CSS, not by a Tailwind `transition` class, no longer turns instant on hover; the repository panel's chevrons are the only ones today, and they turn on expand.
- An extension panel's `box-content` now takes effect; the unlayered reset used to beat it.
- A daisyUI component class does nothing in the app until its name is added to `include:`.
- `sidebar-archived.test.ts` checks the window and `tests/e2e/archive-restore.spec.ts` checks the rows the list shows.
  Nothing enforces the selector rule or the daisyUI include, and no spec holds a time budget (0046); the frame journal in Stats shows a regression.
