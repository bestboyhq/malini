# @malini/hyper-ui

malini's design system: the shared Svelte components, the icon set, and the token, theme and component stylesheets the app is built out of.

It is **source-consumed**.
There is no build step and no `dist/`: consumers import the `.ts` and `.svelte` files directly and their own bundler compiles them.
That keeps a component editable in one place and reviewable in the running app without a publish loop.

## Using it

The app resolves this package two ways, and both are wired:

| specifier                            | resolved by                                       |
| ------------------------------------ | ------------------------------------------------- |
| `$hyper-ui/components/button`        | the `$hyper-ui` alias (electron-vite, TypeScript) |
| `@malini/hyper-ui/components/button` | the package `exports` map                         |

Import the folder module, not the file inside it:

```ts
import { Button } from '$hyper-ui/components/button';
import { Icon } from '$hyper-ui/icons';
```

## Styles

`src/styles/index.css` is the single host entry, and the host imports it once:

```css
@import '@malini/hyper-ui/styles';
```

The import order inside it is load-bearing: tokens, then themes, then the text-color utilities that read the theme properties, then the component stylesheets, and the hover override last so it sits after every other utility in its layer.

Tailwind is v4, wired through `@tailwindcss/vite` in the host.
The package carries its own `@source '../'` directive so the utilities used inside these components are generated rather than purged.
A missing `@source` is not a build error; it is unstyled components.

## Layout

```
src/
  components/<kebab-name>/   folder module: index.ts + Component.svelte
  overlay/                   stacking and suppression, shared by the overlays
  icons/                     glyphs/*.svg sources, glyphs.generated.ts, Icon.svelte
  styles/                    index.css + tokens/ themes/ components/
```

Each glyph is one SVG in `src/icons/glyphs/`; `pnpm --filter @malini/hyper-ui icons` validates them and regenerates `glyphs.generated.ts`.
The `draw-icon` skill has the drawing grammar and the review loop.

## Checks

The package has no test runner of its own.
Its vitest configs are registered as projects of the app's vitest config, so `pnpm --filter malini test` runs everything here.

Component checks that need a DOM get their own project, as `src/components/toast/vitest.toast.config.ts` does:

```sh
npx vitest run --config packages/hyper-ui/src/components/toast/vitest.toast.config.ts
```
