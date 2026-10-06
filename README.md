<img src="apps/malini/build/icon.png" alt="malini" width="128">

A local-only desktop app for running coding agents in git worktrees and turning the prompts you repeat into routines.

Electron main process in TypeScript, Svelte 5 renderer, `gh` CLI as the only GitHub surface.

```sh
corepack enable pnpm   # once; the repo pins pnpm 12 in package.json
pnpm install
pnpm dev          # native window with HMR
pnpm test         # unit and contract tests
pnpm test:e2e     # Playwright drives the built app
pnpm dist         # release/mac-arm64/malini.app
```

## Where things live

| Path                              | What                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `apps/malini`                     | the Electron app                                                                                                               |
| `apps/malini/src/lib`             | one folder per domain: `app`, `chat`, `pull-requests`, `routines`, `extensions`, and the shared `repositories` and `providers` |
| `apps/malini/src/main`            | main-process bootstrap: database, IPC registry, git, docker, processes                                                         |
| `apps/malini/src/contract`        | the typed command and event contract between the two processes                                                                 |
| `packages/agent-bridge`           | the agent process the app runs every chat through                                                                              |
| `packages/extension-api`          | the extension contract and its test host                                                                                       |
| `packages/hyper-ui`               | the design system: components, icons, tokens                                                                                   |
| `packages/eslint-plugin-hyper-ui` | the lint rules, including the domain boundaries                                                                                |
| `extensions/repository`           | the Repository extension: the Files panel                                                                                      |

Each domain folder holds its renderer layers and its main-process code.
Conventions for agents are in `AGENTS.md`, and the rules are in `.agents/rules/`.

## Usage data

malini sends anonymous usage data to PostHog: which features are used, and errors.
It never sends your code, prompts, paths or keys.
Turn it off under Settings, Privacy, Share usage data.
A build without `MAIN_VITE_POSTHOG_KEY` in `apps/malini/.env` sends nothing.

## License

Copyright (C) 2026 Best Boy

malini is licensed under [AGPL-3.0-only](LICENSE).
`packages/extension-api` is licensed under [MIT](packages/extension-api/LICENSE), so an extension can use any license.

Additional permission under GNU AGPL version 3 section 7: if you modify this program, or any covered work, by linking or combining it with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, or a modified version of that library), containing parts covered by the terms of Anthropic's license for that SDK, the licensors of this program grant you additional permission to convey the resulting work.

Claude, Claude Code and the Claude logo are trademarks of Anthropic, PBC.
Third-party names and logos are not covered by this license and appear only to identify those products.
