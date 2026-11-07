# 0169 - A page in Malini's own frames scrolls only itself

Status: accepted

## Context

Reports show HTML variants as live pages in iframes in the transcript (0048, 0128), served over `malini-worktree://` (0010).
The user found the chat "hijacked": while they scrolled, the transcript jumped by 1,000 to 2,200 px in one frame, with no height change and no `scrollTop` write from Malini.
Pages the agent wrote end with `document.getElementById('plans').scrollIntoView({ block: 'start' })`, so a prototype opens on its section.
Chromium carries `scrollIntoView` up through every ancestor scroller, across origins, so each page pulled the chat scroller to its section on load.
The transcript window (0024) unmounts runs out of view and mounts them again, so every remount reloaded the frame and pulled the chat again.
Blanking the frames removed every jump, and neither `overflow-anchor: none` nor `--disable-smooth-scrolling` did.

## Decision

- `serveWorktreeFiles` in `apps/malini/src/lib/browser/platform/worktree-files.ts` registers one handler per session.
  The default session serves only the frames inside Malini's own window; `BROWSER_PARTITION` serves the browser tab, a top-level page.
- For the default session, an `.html` or `.htm` file gets one inline script right after its doctype, before any script of its own.
  It wraps `Element.prototype.scrollIntoView` to pass `container: 'nearest'`, so the page scrolls its own scroller and never Malini's.
  The bytes around it pass through untouched, read and joined as `latin1`, and `Content-Length` goes.
- The browser tab serves every page as written.

## Consequences

- A page in a report scrolls itself into place, and the chat stays where the user left it.
- A target inside a nested scroller moves only that scroller, so its page stays put; the `ponytail:` comment on `CONTAINED_SCROLL` names it.
- Fragment navigation and `focus()` inside a page stay as Chromium handles them; the script covers `scrollIntoView` alone, the call agent pages make.
- `report-media.spec.ts`, "a page that scrolls itself into place on load leaves the chat at its bottom", serves such a page and fails when the chat leaves its bottom; it measured 676 px before this.
