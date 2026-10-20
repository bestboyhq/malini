# Packaging

`pnpm dist` builds an unsigned `Malini.app` under `apps/malini/release/`.
It carries no update feed, so it never updates itself.

## What ships

`electron-vite` bundles the main process, the preload and the renderer into `out/`, dependencies inlined, so the packaged app carries no `node_modules` and pnpm's isolated layout never reaches electron-builder.
`apps/malini/package.json` therefore has no `dependencies` block, and adding one would break that.

The repository extension is imported as a module and rides inside the renderer bundle, so it needs no packaging of its own.

## The agent bridge

The bridge is the one thing electron-vite cannot bundle: it runs as a child process on Electron's own binary with `ELECTRON_RUN_AS_NODE=1`, so `selectBridgeScriptPath` (in `src/lib/chat/platform/agent/service.ts`) reads it from `resourcesPath/agent-bridge/cli.js` at run time.
`pnpm dist` builds the bridge first, and `extraResources` copies `packages/agent-bridge/dist` there with the bridge's `package.json` beside it.

The bridge's one runtime dependency, the Claude Agent SDK, is resolved out of pnpm's symlink farm into `dist/node_modules` by `scripts/copy-runtime-dependencies.mjs`.
electron-builder drops a `node_modules` folder at the root of an `extraResources` source, so `dist/node_modules` is copied by its own entry.
The SDK's platform binaries are overridden away in `pnpm-workspace.yaml`, because the bridge always runs the user's own `claude`.

## The GitHub CLI

Malini reaches GitHub through `gh` (ADR 0014), and a Mac may not have it, so the app carries its own.
`scripts/fetch-gh.mjs` downloads the `gh` release pinned by `GH_VERSION` for macOS arm64, refuses it unless its sha256 matches `GH_SHA256`, and unpacks `bin/gh` and its `LICENSE` into `apps/malini/vendor/gh`, which git ignores.
`pnpm dist`, `release` and `test:update` run it before electron-builder, and `extraResources` copies the folder to `Resources/vendor/gh`.
At boot the main process appends `Resources/vendor/gh/bin` to `PATH`, so a `gh` the user installed still comes first.
To move to a newer `gh`, change `GH_VERSION` and `GH_SHA256` together, taking the hash from the release's `checksums.txt`.

## Licenses

`extraResources` ships Malini's `LICENSE`.
Each bundle in `out/` carries a `THIRD_PARTY_NOTICES.txt` with the license of every npm package whose code or assets it contains, generated at build time by `scripts/third-party-notices.mjs`.
The build fails when a bundled package declares no license.
The SDK carries its own `LICENSE.md` inside `agent-bridge/node_modules`, and `gh` its MIT `LICENSE` inside `vendor/gh`.

## Releases

Every push to `main` that passes CI runs `apps/malini/scripts/version.mjs`, which reads the Conventional Commit subjects since the last `v*` tag.
A breaking change (`!` or a `BREAKING CHANGE:` footer) bumps the major, a `feat` the minor, a `fix` or `perf` the patch; anything else releases nothing.
The first release is `0.1.0`, and `package.json`'s version is a placeholder CI overwrites.
`.github/workflows/pr-title.yml` keeps PR titles in that shape, since a squash merge makes the title the subject.

The `release` job signs with the Developer ID certificate and notarizes the app and the disk image.
The `update` job runs `pnpm --filter malini test:update` on its own runner at the same time.
Once both pass, the `publish` job runs `gh release create` with the dmg, the zip and `latest-mac.yml`.
They need the repository secrets `CSC_LINK` (the base64 `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`.
The bundle takes the product name from `productName` in `apps/malini/package.json`, `Malini`, while every file a release publishes keeps the lowercase identifier: `electron-builder.yml` spells out `artifactName` for both targets (ADR 0033).
The dmg is named `malini-arm64.dmg`, without a version, so `releases/latest/download/malini-arm64.dmg` always serves the newest release; the README's download button links there.
The zip is named `malini-<version>-arm64-mac.zip`, and `latest-mac.yml` points the update feed at it.
`pnpm --filter malini release` builds the same artifacts locally, signed with the keychain's Developer ID and notarized only when `APPLE_KEYCHAIN_PROFILE` is set.

## Updates

`electron-builder.yml` publishes to GitHub Releases and bakes the feed into the app as `app-update.yml`.
`src/lib/app/platform/updates.ts` checks on launch, every hour and on wake, and downloads in the background; Squirrel.Mac verifies the Developer ID signature and installs the update when Malini quits.
It keeps checking once an update is staged, and stages a newer release over it, since `main` can ship several releases a day.
The app menu offers Check for Updates… and, once an update is staged, Restart to Update, which checks once more and installs the newest release.
Squirrel cannot replace an app outside an Applications folder, so a packaged Malini started elsewhere offers to move itself there.

`pnpm --filter malini test:update` builds 0.0.1, 0.0.2 and 0.0.3 under their own name and app id, serves them from a local feed, and proves both paths: quitting 0.0.1 with 0.0.2 staged installs 0.0.2, and Restart to Update, once the feed has moved on to 0.0.3, installs and relaunches 0.0.3.
0.0.1 carries the lowercase product name, the way every release before the rename shipped, and 0.0.2 the capitalized one, so the run also proves that an installed lowercase bundle takes the renamed update in place and that 0.0.2 opens the data folder of 0.0.1 and decrypts a secret 0.0.1 sealed.
The builds carry `MALINI_BACKGROUND_WINDOW` in `LSEnvironment`, so the relaunched app stays behind every window too.
It needs a Developer ID identity in the keychain, because Squirrel installs only signed updates.
