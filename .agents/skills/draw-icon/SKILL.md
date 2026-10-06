---
name: draw-icon
description: Add or redraw a glyph in malini's icon pack. Use when a UI needs an icon that `$hyper-ui/icons` does not have, or when changing how an existing glyph looks.
---

# Draw an icon

Every glyph is one SVG file in `packages/hyper-ui/src/icons/glyphs/`, drawn on a 16px grid with a 1.5px round outline.
The generator (`pnpm --filter @malini/hyper-ui icons`) validates every file and writes `glyphs.generated.ts`, which `<Icon name="…" />` renders.
`pnpm check` fails when a file breaks the frame or the generated module is stale, so the pack cannot drift silently.
What the generator cannot judge is how a glyph looks next to its neighbours; the sheet is for that.

## Steps

1. **Reuse.** Render the whole pack and read it:
   `node .agents/skills/draw-icon/scripts/sheet.mjs "" .context/icons/sheet.png`.
   Done when you name an existing glyph that carries the meaning (use it, stop here), or have looked at every glyph and none does.
2. **Draw** `glyphs/<name>.svg`.
   Copy the `<svg>` line from any existing glyph, then draw to the grammar below.
3. **Generate** with `pnpm --filter @malini/hyper-ui icons`.
   Done when it prints the glyph count and no problems.
4. **Review** the new glyph beside the glyphs it will sit next to in the UI, at least three:
   `node .agents/skills/draw-icon/scripts/sheet.mjs <name>,<neighbour>,<neighbour> .context/icons/<name>.png`.
   Read the PNG.
   Done when, at 12 and 16px on both the light and dark rows, it matches its neighbours in stroke weight, optical size and corner radius, and the zoomed view shows no stroke past the red live-area box.
5. **Use** it as `<Icon name="<name>" size={14} />`.
   Colour comes from a `text-*` class on the icon or its parent.
6. **Verify** in the running app with the `test-malini-app` skill.

## Grammar

- **Frame.** The `<svg>` attributes are fixed: 16 grid, `stroke="currentColor"`, `stroke-width="1.5"`, round caps and joins.
  Shapes carry geometry only.
- **Shapes.** Self-closing `path`, `circle`, `ellipse`, `rect`, `line`, `polyline`, `polygon`.
- **Live area.** Stroke centrelines stay inside 1.75 to 14.25 (the red dashed box).
  The generator checks every endpoint and control point, but an arc only by its ends, so check arc bulges on the zoom.
- **Keylines** (blue): a round glyph is a circle of r 5.75 on the centre; a square glyph spans 2.75 to 13.25; a window or card spans 2.25 to 13.75 by 2.75 to 13.25 with `rx="2.25"`.
- **Coordinates.** Quarter steps, at most two decimals.
  Straight edges on .25 or .75 land on whole device pixels at 2x; a centred stroke at 8 trades that crispness for symmetry.
- **Air.** Keep parallel centrelines at least 2.5 apart, a 1px gap between strokes, or the gap closes at 12px.
- **Dots.** The point of a `!` or `?` is `M8 11h.01`: a round cap one stroke wide.
  A standalone dot (grip, more) is `<circle r=".5" fill="currentColor" />`; a stroked circle smaller than r 1 renders hollow on retina.
- **Fill.** `fill="currentColor"` only where a solid shape is the meaning (`stop`).
  Every other glyph is outline, and a meaning has one glyph: no bold or filled twin.
- **Name.** Kebab-case, after what the glyph depicts, or after its meaning where the drawing is generic (`pr-merged`).

## Outside the pack

Standalone components in `packages/hyper-ui/src/icons/`, exported from its `index.ts`:

- brand marks (`ClaudeIcon`),
- animated indicators (`BusyIcon`),
- a pack glyph with a paint effect (`SendIcon`), which draws from `glyphs` and `glyphFrame` rather than copying path data.

File-type icons come from `FileTypeIcon`, never from the pack.
