# 0300 - A page in Malini's own frames takes focus only from the user

Status: accepted

## Context

Reports show HTML variants as live pages in iframes in the transcript (0048, 0128, 0224), and 0173 left `focus()` inside them as Chromium handles it.
The user found the composer "losing focus repeatedly" whenever a prototype was in the chat, and their typing went into the prototype.
Prototypes the agent writes often focus a field on load or on a timer, and every remount of a report's frame loads the page again.
Chromium blocks `autofocus` in a cross-origin frame, but not a script's `focus()`, `select()` or `window.focus()`.
A user activation check does not tell the two apart: the renderer is a `file://` page that Electron lets reach every origin, so Chromium's same-origin activation visibility gives the frame the activation of every key typed in the composer.
Neither `allow="focus-without-user-activation 'none'"` nor that Blink feature turned on in `webPreferences` stopped the frame in Electron 44.

## Decision

- The script `serveWorktreeFiles` in `apps/malini/src/lib/browser/platform/worktree-files.ts` puts after an `.html` or `.htm` file's doctype for the default session now has two parts, `CONTAINED_SCROLL` (0173) and `FOCUS_STAYS_WHERE_THE_USER_PUT_IT`.
- `FOCUS_STAYS_WHERE_THE_USER_PUT_IT` wraps `HTMLElement.prototype.focus`, `SVGElement.prototype.focus`, `HTMLInputElement.prototype.select`, `HTMLTextAreaElement.prototype.select` and `window.focus`; each runs only while `document.hasFocus()` is true in the page, and does nothing otherwise.
- A click or a Tab puts focus in the page the way Chromium always does, and from then on the page moves focus inside itself freely.
- The browser tab still serves every page as written: a page there runs in its own `WebContentsView` and cannot take focus from Malini's window.

## Consequences

- A live prototype in a report, or in the media viewer, never takes the composer's focus, and keys typed in the composer stay there.
- A page that focuses a field on load shows it unfocused in the chat until the user clicks into it.
- A `mousedown` handler that calls `focus()` before the page holds focus does nothing on that first press, and `showModal()` or a popover with `autofocus` can still take focus; the script covers the calls agent pages make.
- `composer-focus.spec.ts`, "a live prototype in the chat or the browser tab never takes the composer's focus", serves a page that calls `focus()`, `select()` and `window.focus()` every 200 ms, and fails when the composer loses focus or its text; it failed before this.
- The e2e window sends no mouse input into an out-of-process frame, so the click that puts focus in a page is checked in Malini's browser, not in that test.
