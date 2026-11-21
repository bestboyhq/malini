# 0278 - Windows and Linux get traffic lights Malini draws, at the top bar's left end

Status: accepted

## Context

0261 put the OS's minimize, maximize and close buttons over the top bar's right end through `titleBarOverlay`, tinted to the theme.
The user: "this application was not prepared for this and certainly wasn't designed to be treated like that and it was designed to have those so-called you know traffic lights, equivalents, top left corner of the whole window", and asked for them "on the bar with macOS on the UI and UX side".
The layout was drawn for controls at the left: the caption buttons took about 140 px from the top bar's right end, so the GitHub status gave up its dock over the inspector off macOS, and every new top bar control had to clear them.
Chromium paints the overlay buttons itself, so their shape, hover and inactive state followed Windows 10 on every OS, Linux included, and the tint could only change two colors.
macOS 27 draws its lights 14 px wide, their origins 23 px apart, at 12, 13 in the 40 px top bar, grey while the window is in the background, with a glyph in each while the pointer is over any of them.

## Decision

- **No OS controls (amends 0261).**
  `titleBar(platform)` in `src/main/window.ts` sets `titleBarStyle: 'hidden'` with no `titleBarOverlay` on Windows and Linux, so neither OS draws a caption button.
  macOS keeps `hiddenInset` at 12, 13.
- **Malini draws the lights.**
  `WindowControls.svelte` in `src/lib/app/presentation/` renders on every OS but macOS, from `AppShell.svelte`, outside the top bar's stacking context at the highest `z-index`, so it stays above a modal as the real lights do.
  It sits at `--native-traffic-light-inset-x` and `-y`, each light `--native-traffic-light-size` wide with a 9 px gap, all divided by `--native-zoom`, the geometry macOS has.
  Close is red, minimize yellow and maximize green, from `--color-window-*` in hyper-ui's `colors-semantic.css`.
  While the window is in the background all three take `--color-window-control-inactive`, and a pointer over them brings the colors back.
  A pointer over any light shows the `close`, `minus` and `window-maximize` glyphs in all three, 12 px in the 14 px light; once the window is maximized the green light shows `window-restore` and restores it.
  The lights are no tab stop and take no focus on press, as the OS's own.
  They hide in full screen, as on macOS.
- **The main process owns the state.**
  `app.window-controls` returns `{ focused, maximized }` for the main window, and `app:window-controls-changed` carries it on every `focus`, `blur`, `maximize` and `unmaximize`, not logged.
  The page cannot read focus itself: its own `blur` fires whenever the inspector's web view takes focus.
  `app.press-window-control` `{ control }` calls `close`, `minimize`, `maximize` or `unmaximize`, and refuses any other control.
- **The tint goes.**
  `app.tint-window-controls`, `tintWindowControlsCommand`, `windowControlsTint()` and `DEFAULT_TINT` are deleted.
- **The right end belongs to Malini again.**
  `base.css` drops `--native-caption-clearance`, and `TopBar.svelte` drops its right padding off macOS.
  The GitHub status docks over the inspector on every OS, at the inspector's width.
  **Menu** stays beside the lights, where 0261 put it, after the same 80 px clearance macOS has.

## Consequences

- Windows and Linux show the window as macOS does: lights at the left, the status over the inspector, and nothing at the right end but Malini's own controls.
- Windows 11's snap layouts no longer open from a hover on maximize, because Malini's button is not the caption button the OS hooks; **Win+Z** still opens them, and `apps/site/content/window.md` says so.
- A Linux desktop that puts its buttons at the right, or themes them, no longer changes Malini's controls.
- `apps/malini/tests/e2e/window-chrome.spec.ts` enforces it on the macOS, Linux and Windows CI runners:
  - no OS overlay on any OS, and **Close**, **Minimize** and **Maximize** only on Windows and Linux;
  - each light calls its window method, the green one turns into **Restore** on `maximize` and back on `unmaximize`, and a press leaves the focus where it was;
  - no other control sits under the lights with the sidebar or the inspector open, or at the 900 px minimum width.
- `src/lib/app/platform/window.test.ts` checks the announced state and that an unknown control is refused.
- CI has no window manager, so the tests spy on the window methods and emit the events; a real minimize, maximize and focus change were not checked in CI.
