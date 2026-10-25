# 0078 - Markdown files open Raw, and the editor shows its cursor and selection

Status: accepted

## Context

0069 opened every Markdown File tab **Rich**, so a changed README with HTML blocks such as `<p align="center">` showed as a rendered page that did not match the file.
The user does not want those blocks rendered properly: "I think it's like not worth it, but we should just default to raw [...] and not be so proactive about enabling reach mode for someone".
The editor itself was hard to read: the user was "losing a sight of" the blinking cursor, the selection was "nearly invisible", and there was "some weird margin from the left of the text content".
In the app the cursor was a 1.2 px line that spent half of each 1.2 s blink gone, and the selection was 18% of `--color-fg-default` drawn under each line.
The active line and every added line painted an opaque background over that layer, so a selection vanished on them entirely.
Each line started 12 px right of where the active line band began.

## Decision

- Markdown File tabs open **Raw**; **Rich** is one click away in the same switch, and each path still keeps the view the user left it in until the extension stops.
  Everything else 0069 decided still holds.
- `drawSelection({ cursorBlinkRate: 0 })` keeps the cursor on, drawn 2 px wide in `--color-fg-default`.
- The selection is 35% of `--color-accent`.
  Every line background in `FILE_TAB_THEME` is translucent, so the selection under it shows through: the active line is 5% of `--color-fg-default`, and added and removed lines mix their code color with `transparent` instead of `--color-surface-50`.
- A line starts 4 px after the active line band, and the line numbers keep 12 px to their right instead.
- The line numbers hug the left edge, 8 px from it, right after the green or red change strip, and the gutter is only as wide as its longest number.
  CodeMirror keeps the gutter sticky, so numbers and strips stay put while a long line scrolls sideways.
- Opening a file whose tab is already open reads it from disk again, which still leaves unsaved typing alone.

## Consequences

- A Markdown file shows its text first, so HTML that **Rich** renders differently from GitHub never greets the user.
- Any background a later change adds behind a line has to stay translucent, or it hides the selection again.
  Nothing enforces this.
- Enforced by `file-tab.test.ts` (**Raw** first, **Rich** remembered, a line opens **Raw**, an open tab reads the file again) in the repository extension and `tests/e2e/file-editing.spec.ts`, which edits a Markdown file in **Raw**, renders it in **Rich** and switches a long file both ways.
