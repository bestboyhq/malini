# 0251 - Windows and Linux draw the window controls over the top bar, and the menu opens from one button

Status: accepted

## Context

Since 0248 Malini opened on Windows and Linux in the OS's own frame, with Electron's 27 px menu bar under the title bar, so two bars sat above Malini's 40 px top bar.
macOS has one bar: `hiddenInset` puts the traffic lights inside the top bar, and the menu lives in the screen's menu bar.
The user: "our users expect to have the same experience as they have on macOS on all the other platforms", and the round 2 brief asked for window controls overlay with the theme's colors, a menu button where the traffic lights sit, Alt for the menu, every shortcut with the menu bar hidden, a draggable top bar and a Linux window icon.
Electron 44.4.0 to 44.4.3 never fired `ready-to-show` for a `show: false` window with `titleBarOverlay` on Windows (electron/electron#54025, fixed in 44.4.4), and Malini shows its window on that event.
Electron before 44.5.0 drew a grey border around a frameless window on a Linux desktop without compositing (electron/electron#52024).

## Decision

- **One bar.**
  `titleBar(platform)` in `src/main/window.ts` keeps `hiddenInset` with the traffic lights at 12, 13 on macOS.
  On Windows and Linux it sets `titleBarStyle: 'hidden'` and a `titleBarOverlay` 40 px high, the top bar's height, so the OS's minimize, maximize and close buttons sit at the top bar's right end.
  The window still shows on `ready-to-show`.
- **The theme tints the controls.**
  `tintWindowControlsCommand` reads `--color-surface-root` and `--color-fg-secondary` through `windowControlsTint()` in `appearance-document.service.ts`, turns them into `#rrggbb` through a 1 px canvas, and sends them as `app.tint-window-controls` `{ background, symbol }`.
  The theme commands (`choose-theme-mode`, `follow-system-theme`, `tune-appearance`) run it on every change, and `follow-system-theme` runs at boot.
  `src/lib/app/platform/window-controls.ts` refuses anything but `#rrggbb` and calls `setTitleBarOverlay` with `windowControlsOverlay(tint)`: the background at alpha 0, so the top bar shows through, and the symbol color.
  `DEFAULT_TINT` in `window.ts` paints the first frame before the renderer reports: `#161413` and `#b8b5b2` dark, `#ede9e7` and `#42403f` light.
- **Nothing sits under the controls.**
  `base.css` sets `--native-traffic-light-clearance` to `env(titlebar-area-x)` plus 12 px, and `--native-caption-clearance` to the width right of `env(titlebar-area-width)`, off macOS only.
  `TopBar.svelte` pads its right end by the caption clearance, and the docked inspector's top bar part gives up the same width.
- **The menu opens from one button (amends 0248).**
  Off macOS the window has no menu bar, and `applicationMenu()` in `src/lib/app/platform/menu.ts` stays the application menu, so its accelerators stay registered.
  `AppMenuButton.svelte` sits at the top bar's left end, where macOS has its traffic lights: an icon button named **Menu**, with the same tooltip and `aria-haspopup="menu"`.
  A click sends `app.pop-up-menu` `{ x, y }`, the button's bottom left plus 6 px in CSS pixels, and the main process scales them by the zoom factor and calls `Menu.popup` there.
  Alt pressed and released with no other key in between, no pointer press and no wheel, pops up the same menu.
- **Every shortcut works with the menu bar hidden.**
  **Ctrl+N**, **Ctrl+T**, **Ctrl+O**, **Ctrl+,** and the edit and view roles reach the hidden menu.
  The `zoomIn` role's accelerator is `CommandOrControl+Plus`, which is **Ctrl+Shift+=** on a US keyboard, so the File menu carries a hidden `zoomIn` item on `CommandOrControl+=`; Electron registers the accelerator of a hidden item.
- **The top bar drags the window.**
  Its empty parts are `-webkit-app-region: drag` and its controls `no-drag`, as on macOS.
  A double-click on an empty part maximizes the window, and another restores it.
- **Linux gets an icon.**
  The window's `icon` is `build/icon.png` at 256 px, so `_NET_WM_ICON` carries Malini's mark in the dock, the taskbar and Alt+Tab.
- **Electron 44.11.3.**
  The catalog in `pnpm-workspace.yaml` moves Electron from `^44.4.0` to `^44.11.3`, past both bugs above.

## Consequences

- Windows and Linux show one bar like macOS, and the controls follow the theme.
- A menu bar's mnemonics are gone: **Alt+F** opens nothing, and Alt alone opens the whole menu, where the arrow keys move.
- A new top bar control must stay clear of the caption buttons.
- macOS keeps every option, pixel and menu it had.
- On Linux the popup menu takes the desktop's GTK colors, not Malini's theme.
  `nativeTheme.themeSource` reaches the page and the window controls but not GTK, so a dark Malini on a light desktop opens a light menu, and a dark desktop opens a dark one.
- On X11, Electron 44.11.3 aborts with a `length_error` in `basic_string` when a popup menu closes within milliseconds of opening.
  A two-item menu built from scratch did it in 6 of 6 runs and the application menu in 4 of 6, and no menu did in 12 runs at 150 ms or 500 ms.
  A person never closes a menu that fast, so `window-chrome.spec.ts` keeps the menu open for 500 ms, which also proves it stays open, and closes it with `closePopup`.
- `apps/malini/tests/e2e/window-chrome.spec.ts` enforces it on the macOS, Linux and Windows CI runners:
  - the window shows on every OS, and only Windows and Linux draw the overlay and the **Menu** button;
  - the **Menu** button and Alt alone pop up the menu under the button, and **Alt+F** and **Ctrl+Alt** do not;
  - **Ctrl+,**, **Ctrl+T**, **Ctrl+A**, **Ctrl+=**, **Ctrl+-**, **Ctrl+Shift+=**, **Ctrl+0**, **Ctrl+O** and **Ctrl+N** work with the menu bar hidden;
  - no control sits under `navigator.windowControlsOverlay.getTitlebarAreaRect()`'s caption area with the sidebar or the inspector open, or at the 900 px minimum width;
  - the tint changes with the theme and comes back the same.
- `window-controls.test.ts` checks the tint and the zoomed menu point on Windows and Linux, that macOS is left alone, and that a malformed tint or point is refused.
- Nothing in CI drags the window or presses a physical key: CI sends input to the page, under the OS's own handling.
  The drag, the double-click, the caption buttons and a real Alt and **Ctrl+,** were checked once on Linux, in a container under openbox with `xdotool`, and the same on Windows needs a person.
  The window follows the pointer once the pointer passes Chromium's drag threshold, as in any app that drags from its own title bar.
