# 0295 - The renderer draws the menu bar badge

Status: accepted

## Context

Malini's menu bar icon showed the unread chat count as title text beside the stack glyph, through `tray.setTitle` with monospaced digits.
The user found that look poor, compared four directions, and picked a solid badge cut into the bottom-right corner of the stack, with heavy monospace digits.
A template image is the only way to put a count inside the icon, so something must draw a new image for each count.
The main process has no canvas, and Electron's `nativeImage.createFromNamedImage` SF Symbols, tried in the real app, come at 1x only, with thin digits, and stop at 50.
Chromium cannot reach SF Mono, so a monospace face must come from what the renderer already loads.

## Decision

`drawTrayBadge` in `src/lib/shared/system/tray-badge.ts` draws the badge in the renderer on an `OffscreenCanvas`, at 2x.
It draws `build/tray/trayTemplate@2x.png`, cuts a capsule 3.5 px wider than the badge out of it, fills the badge, and cuts the count out of the badge, `99+` above 99.
The digits are Geist Mono Variable, the app's own `--font-mono`, at weight 800 and 14 px, and the drawing waits for `document.fonts.load` first.
The canvas is 36 px high and an even number of pixels wide, so the icon is a whole number of points.
`NotificationService.showUnreadCount` sends the PNG bytes with the count through `app.unread-chats`, `{ count, icon }`, with `icon` null at zero, and drops a drawing that a newer count overtook.
`register.ts` accepts `icon` only as a `Uint8Array` of 64 KB or less that starts with the PNG signature, or null.
`shell-host.ts` makes it a template image at scale factor 2, shows it with `tray.setImage` when it is 18 points high, and otherwise shows the plain stack.
The tooltip names the count, `Malini, 3 unread chats`, and the title text is gone.

## Consequences

The badge can take any shape and any count the canvas can draw, and it matches the app's type.
The main process trusts no pixels it did not check: a wrong size or a non-PNG falls back to the plain stack or is refused.
The tray changes only while a renderer runs, and the window-closed path resets it to the plain stack.
`register.test.ts` checks the validation and what reaches the host; nothing checks the drawing itself, so a change to it needs a native capture of the bytes `app.unread-chats` receives.
