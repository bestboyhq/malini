# Packaging

`pnpm dist` builds an unsigned `.app` under `apps/malini/release/`.

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

## Licenses

`extraResources` ships malini's `LICENSE`.
Each bundle in `out/` carries a `THIRD_PARTY_NOTICES.txt` with the license of every npm package whose code or assets it contains, generated at build time by `scripts/third-party-notices.mjs`.
The build fails when a bundled package declares no license.
The SDK carries its own `LICENSE.md` inside `agent-bridge/node_modules`.
