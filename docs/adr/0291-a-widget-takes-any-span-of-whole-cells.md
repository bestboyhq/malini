# 0291 - A widget takes any span of whole cells

Status: accepted

## Context

0288 copied the iOS sizes: a placement stored `small`, `medium` or `large`, and the corner snapped to one of the three.
Simon wants more: "I want to resize my widgets any way I want I don't want to have any limitations on that, aside from having them be aligned within the bento grid obviously".
He also found the sizing outline wrong: "this outline is cut like it's not fully visible", and "it's also weird that it's purple I wouldn't expect it to be purple".
The outline was a `ring-accent` drawn outside the slot, so the board's scroll area clipped it at its edges.
A tile already drops the rows that do not fit, so a taller tile needs more room, not a new drawing.

## Decision

- A placement stores a span, `span_columns` and `span_rows` in `widget_placements`, each a whole number from 1 to 12 that a SQLite `CHECK` holds; `WIDGET_SPAN_MAX` is 12, and 12 columns means as wide as the panel.
  A migration turns each stored size into its span: small 1 by 1, medium 2 by 1, large 12 by 2.
- `widgets.place` and `widgets.resize` take a `span`, and `isWidgetSpan` in `src/contract/widgets.ts` refuses anything else.
- `WIDGET_SIZE_SPANS` keeps the three presets: the menu offers them, a new widget starts at its file's size, and a new board places the Plan at Large.
  A `.malini/widgets` file still names its default size, and `widgets_save` still takes one.
- The corner snaps to whole cells through `snappedSpan` in `widgets/domain/widget-grid.ts`, and the tile takes its span live while it is dragged.
  A tile as wide as the panel stays that wide when only its height changes, so a full-width Large keeps filling a wider panel.
  `shownSpan` clamps the columns to the grid, so a span wider than the panel shows full width and keeps its stored span.
- `spanLook` picks the drawing from the span: one column draws small, one row draws medium, and the rest draw large.
  `widgetLayout` gives a tile six more rows for each row of cells past its look's own height.
- `tileName` names a tile by its preset, such as "Plan, Large", when its span matches one, and by its cells otherwise, such as "Plan, 3 by 2"; the menu then checks no preset.
- The sizing outline is a neutral `after:` border inside the slot, and the placeholder and grid cells are neutral dashed borders, so nothing is purple and the scroll area clips nothing.
- Everything else in 0288 stands.

## Consequences

- A widget can be any size the grid fits, and the menu still gets it back to a preset in one click.
- A span stays stored as set when the panel narrows, and comes back when it widens.
- A new drawing needs no new size: a look is derived from the span, and only taller tiles get more rows.
- Enforced by `src/lib/widgets/domain/widget-grid.test.ts` (snapping, full-width spans, presets), `widget-layout.test.ts` (more rows for a taller tile), `widget-text.test.ts` (tile names), `src/lib/widgets/platform/register.test.ts` (spans stored and refused on real SQLite), `src/main/db/migrations.test.ts` (each size becomes its span, and a span past 12 fails the check), and `tests/e2e/widgets.spec.ts` (the corner resizes a Large tile to 1 by 3 in the built app).
