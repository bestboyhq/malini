# Agent conventions for malini

malini is a desktop-first product.
The shipping surface is the Electron app in `apps/malini`: `src/main` is the Node main process, `src/preload` is the typed bridge, `src/contract` is the shared command and event contract, `src/lib` holds the domain slices, and `src/renderer` is the Svelte 5 entry point.
Aliases: `$main` (node only), `$lib` (`src/lib`), `$shared` (`src/lib/shared`), `$contract` (`src/contract`), `$hyper-ui`.
There is no backend service and no cloud.
The app makes two outbound calls of its own.
Anonymous usage data goes to PostHog, from `src/lib/app/platform/usage-data.ts`.
It stays silent without `MAIN_VITE_POSTHOG_KEY` in `apps/malini/.env` (see `.env.example`), and the e2e harness turns it off with `MALINI_USAGE_DATA=off`.
Update checks go to GitHub Releases, from `src/lib/app/platform/updates.ts`, only in a packaged build that carries `app-update.yml`; `pnpm dev`, the e2e harness and `pnpm dist` never check.
Everything else on GitHub is reached through the `gh` CLI.

## Rule 1 - A claim of "done" requires native evidence.

Nothing is done on the strength of a unit test, a scorecard, or a component rendering in isolation.
It is done when the flow completes in the built app or the `pnpm dev` window, proven by a screenshot of that window and a clean console for the interaction.
Capture the app's own window only, never the full screen: `screencapture -o -l <window id> out.png` on macOS.
If you defer something, say so with the reason.
Do not report it closed.

## Rule 2 - Never validate the product with fake data.

Manual and native validation always uses the real platform and real user data.
Fakes exist for the automated tiers only.

## Rule 3 - Test system behavior, never rendering.

Never assert on class strings, colors, spacing, motion timing, or a `.svelte`/`.css` file's text for any of those.
Design-token discipline is lint: `packages/eslint-plugin-hyper-ui` enforces it on every file at edit time.
Accessible names, roles, and `aria-current` are behavior; assert them by role and name in Playwright.
A test may read a component's source when its subject is wiring (which command a control invokes, whether a destructive action sits behind a confirmation).
Name it for that subject.

## Rule 4 - The main process is the platform, the renderer never touches Node.

`contextIsolation` and `sandbox` stay on.
The renderer reaches the main process only through the typed API that `src/preload` exposes on `window.malini`.
Only infrastructure services call it, through `invoke` and `onPlatformEvent` in `$shared/port`, and the automated tiers swap it for a fake.
No `remote`, no `nodeIntegration`, no raw `ipcRenderer` outside the preload.

## Rule 5 - Never put the app in front of the user.

The user keeps working on this machine while agents test.
Every app an agent launches runs in background mode (`MALINI_BACKGROUND_WINDOW=1`): one pixel at the screen edge, behind every window, never focused, no Dock icon.
The e2e harness and `.agents/skills/test-malini-app/scripts/malini.mjs` set it; any other launcher must set it too.
Never run `pnpm dev` or `pnpm start`, and never pass `{ foreground: true }`, unless the user asks to watch.
`apps/malini/tests/e2e/window.spec.ts` fails when a test run's window covers more than one pixel column of any display.

## Layout

Code lives in vertical domain slices under `apps/malini/src/lib/<domain>/`.
A slice holds its renderer layers (`domain`, `application`, `infrastructure`, `presentation`) and its main-process code (`platform/`).
Other domains see it only through `<domain>.api.ts` (renderer) and `<domain>.platform.ts` (main process).

| Domain                 | What it owns                                                          |
| ---------------------- | --------------------------------------------------------------------- |
| `app`                  | shell, sidebar, layouts, pages, routes; may use every other domain    |
| `chat`                 | transcript, composer, prompt queue, sessions and runs, checkpoints    |
| `pull-requests`        | pull request state, actions, top-bar status, merge confirmation       |
| `routines`             | drafts, routines, suggestions, gated runs                             |
| `extensions`           | extension runtime, host adapters, inspector, directory, configuration |
| `$shared/repositories` | shared domain: repositories, clones, workstreams and their lifecycle  |
| `$shared/providers`    | shared domain: model catalog, model ids, provider auth, capabilities  |

`src/main` is node bootstrap only:

```
apps/malini/src/main/
  index.ts            boot: opens the database, builds MainContext, calls registerModules
  context.ts          MainContext: db, commands, events, appDataRoot, resourcesRoot, isDev, appVersion
  ipc/registry.ts     CommandRegistry: define('<domain>.<verb>', handler), typed by $contract
  events.ts           EventBus: emit(channel, payload), subscribe(channel, fn), typed by $contract
  modules.ts          boot order: one register<Domain>(context, deps) call per domain platform
  legacy-app-data.ts  first launch after the rename: moves the smack data folder and its credentials
  db/                 driver (node:sqlite), migrations, open, rows
  git/ docker/ process/ fs/ errors.ts   shared node plumbing for the platform folders
```

Command names are `<domain>.<verb-kebab>` (`chat.send-prompt`), event channels `<domain>:<event-kebab>` (`chat:agent-event`).
Both are declared once in `$contract` and checked on both sides by `pnpm check`.

`.agents/rules/frontend/layout.mdc` has the full tree and `.agents/rules/frontend/cross-domain-imports.mdc` the import rules.
`@malini/desktop/domain-boundaries` enforces both at `error`.

## Running

```sh
corepack enable pnpm           # once; package.json pins pnpm 12 and pnpm 10 cannot self-switch to it
pnpm install
pnpm dev                       # electron-vite dev: main, preload and renderer with HMR
pnpm dogfood                   # the user's daily malini: runs this checkout of main and applies every merge
pnpm --filter malini test:e2e   # builds, then Playwright launches the app
pnpm dist                      # unsigned .app under apps/malini/release/
pnpm --filter malini test:update   # signed builds update themselves from a local feed
```

PR titles are Conventional Commits.
A squash merge makes the title the commit subject, and a `feat`, `fix` or `perf` on `main` ships a release (`docs/packaging.md`).

## Dependencies

`pnpm-workspace.yaml` sets `minimumReleaseAge` to two days: pnpm will not resolve a version published more recently, so a bump lands only once a release has survived that long.
Shared versions live in the catalog there, each hold-back with its reason next to it.
Bump with `pnpm update -r` and read `pnpm outdated -r`; anything still listed is held on purpose or too young.

## Typing

Every package extends `tsconfig.base.json` at the root: strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`.
Plain JavaScript (`.mjs` scripts, the eslint plugin) is checked too, through `checkJs` and JSDoc types.
No `any`, no `@ts-ignore`, no `@ts-expect-error` in product code; a guard beats a non-null assertion.
`pnpm check` runs every package's check.

## Rules

The full rule set is in `.agents/rules/`.
Read the rule for the area you touch.

| Area                               | Rule                                       |
| ---------------------------------- | ------------------------------------------ |
| Agent behavior, git, scratch files | `agent-behavior.mdc`                       |
| Parallel subagents                 | `agent-parallel-subagents.mdc`             |
| Where code lives                   | `frontend/layout.mdc`                      |
| Renderer conventions               | `frontend/default.mdc`                     |
| Cross-domain imports               | `frontend/cross-domain-imports.mdc`        |
| Domain layer                       | `frontend/layers/domain-layer.mdc`         |
| Application layer                  | `frontend/layers/application-layer.mdc`    |
| Infrastructure layer               | `frontend/layers/infrastructure-layer.mdc` |
| Presentation layer                 | `frontend/layers/presentation-layer.mdc`   |
| Platform layer                     | `frontend/layers/platform-layer.mdc`       |
| Renderer shell and runes           | `frontend/electron-vite.mdc`               |
| hyper-ui                           | `frontend/hyper-ui.mdc`                    |
| Events                             | `frontend/eda.mdc`                         |
| Tests                              | `frontend/testing.mdc`                     |

**Rule 0, everywhere: no comments in code.**
If a comment feels needed, the code is wrong.
Rename, extract, or restructure.
The one prose exception is a single-line `ponytail:` comment, described below.
Every lint rule runs at `error`.

## Code: lazy senior developer

Lazy means efficient, not careless.
The best code is the code never written.
Lazy means less code, not less effort: understanding, root cause, and verification still get full effort.

Understand the problem first.
Read the task and the code it touches, and trace the real flow end to end.
Then stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that is already here.
3. Does the standard library do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

Bug fix = root cause, not symptom.
A report names a symptom.
Grep every caller of the function you touch and fix the shared function once.
One guard there is a smaller diff than one per caller, and a fix on only the path the ticket names leaves sibling callers broken.

Rules:

- No abstractions or boilerplate that nobody asked for.
- No new dependency if you can avoid it.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
  The smallest change in the wrong place is not lazy, it is a second bug.
- Complex request? Ship the lazy version and question it in the same response: "Did Y, it covers X. Need full X? Say so."
- Two stdlib options of the same size? Pick the one that is correct on edge cases.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment.
  Name the ceiling and the upgrade path.

Never lazy about:

- Understanding the problem. A small diff you do not understand is laziness dressed up as efficiency.
- Input validation at trust boundaries, error handling that prevents data loss, security, and accessibility.
- Calibration that real hardware needs. A clock drifts, a sensor reads off.
- Anything explicitly requested.
- Tests. Lazy code without its check is unfinished.
  Non-trivial logic leaves ONE runnable check behind: the smallest thing that fails if the logic breaks (an assert-based self-check or one small test file, no frameworks, no fixtures).
  Trivial one-liners need no test.

## Code conventions

Runes-only Svelte 5.
Design tokens only, from `@malini/hyper-ui` (`$hyper-ui` alias): import the folder module `$hyper-ui/components/<kebab-name>`, never a `.svelte` path inside it.
Icons are `<Icon name="…" />` from `$hyper-ui/icons`; a glyph the pack lacks is drawn with the `draw-icon` skill.
Every domain has the layers `domain` / `application` / `infrastructure` / `presentation` in the renderer and `platform` in the main process.
US English everywhere, including identifiers.
Tabs, single quotes, 100 columns (`pnpm format`).
Never edit a `*.generated.ts` file; edit its source and rerun the generator.
