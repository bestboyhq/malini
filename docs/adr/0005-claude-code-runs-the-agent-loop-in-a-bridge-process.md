# 0005 - Claude Code runs the agent loop, in a bridge process

Status: accepted

## Context

An agent loop (tools, compaction, permissions, MCP, skills, `CLAUDE.md`, hooks and model access) is a large product that changes often.
malini's users already have `claude` installed and signed in on their own subscription.
Running the SDK inside Electron's main process would let a crash or a stuck stream take the whole app down, and tie SDK upgrades to the app's process.

## Decision

- malini runs no agent loop of its own.
  `packages/agent-bridge` hands each prompt to the user's installed `claude` through the Claude Agent SDK's `query()` and translates the stream into malini's bridge events.
- The bridge is a child process on Electron's own binary with `ELECTRON_RUN_AS_NODE=1`, speaking newline-delimited JSON over stdio.
- Its protocol (commands, events, timeouts, heartbeat, version) is declared once in `packages/agent-bridge/protocol/bridge-protocol.json` and generated into both sides.
- The SDK's bundled `claude` binaries are overridden away in `pnpm-workspace.yaml`.
- malini keeps git history, approvals, questions and plans; the bridge's Claude adapter enforces that split (`claude-runtime` skill).

## Consequences

- A run behaves like `claude` in a terminal: the user's settings, skills, MCP servers and login apply.
- A bridge crash ends a run, not the app, and the heartbeat timeout catches a bridge that hangs.
- Without `claude` installed there are no agents, so malini has to detect that and explain it.
- The SDK is the one runtime dependency packaging copies by hand (`docs/packaging.md`).
- Enforced by `pnpm check`, which fails when the generated protocol files are stale, and by `readyFrameMismatch` in `src/lib/chat/platform/agent/protocol.ts`, which refuses a bridge that reports another protocol version.
