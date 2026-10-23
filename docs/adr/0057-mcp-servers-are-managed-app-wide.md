# 0057 - MCP servers are managed app-wide

Status: superseded by 0061

## Context

0040 let a chat sign in to one MCP server at a time, from a flat list in the composer's MCPs popover.
A user with some thirty servers saw that list run off the screen, two rows each named Gmail and Google Calendar with nothing to tell a claude.ai connector from a plugin, a sign-in per server, **Retry** on a GitHub server whose token setting was empty, and a toast reading `bridge protocol error: MCP_SERVER_FAILED: …`.
Signing in is not per chat: Claude Code keeps an MCP token for the user, yet each chat only learned about a sign-in once its own Claude Code reconnected.
`mcpServerStatus()` on Claude Code 2.1.293 reports every server's `source`, `scope`, `config` and `tools`, which the bridge dropped.
A tracer bullet showed that `toggleMcpServer` writes `disabledMcpServers` under the folder's entry in `~/.claude.json`, so it would turn a server off for one workstream only, while `deniedMcpServers` in user settings hides a server by its full name (`plugin:productivity:gmail`, `claude.ai Gmail`, `codebase-memory-mcp`) from every Claude Code.
The user picked the grouped popover, a Settings page and a guided fix flow together, with the bulk action named for fixing rather than signing in.

## Decision

- The bridge protocol is version 34 (`packages/agent-bridge/protocol/bridge-protocol.json`).
  `mcp.status` servers carry `source` and `toolCount`.
  `authorize_mcp_server` and `reconnect_mcp_server` take a `sessionId` or a `cwd`; `list_mcp_servers { cwd }` answers `bridge.mcp_servers` from a probe Claude Code that waits until no server is pending, for up to 30 s; `cancel_mcp_authorization { serverName }` closes a pending sign-in probe, and a new sign-in to the same server closes the old one.
- When a sign-in probe settles, or a retry by folder reads a status, the bridge reconnects a connected server in every open chat (`ProviderHandle.adoptMcpServer`) and sends `bridge.mcp_server`, which main emits as `chat:mcp-server-changed`.
- **Turn off** writes `{ "serverName": … }` to `deniedMcpServers` in the user's Claude Code settings and **Turn on** removes it, through `chat.switch-mcp-server` (`apps/malini/src/lib/chat/platform/mcp-servers.ts`), leaving every other deny entry alone; the settings file is read and replaced with the Skills page's `updateClaudeSettings`.
- The MCP commands drop the bridge's error code, so a failure reads as Claude Code's own message.
- The popover groups a chat's servers by their fix (`groupMcpServers` in `chat/domain/mcp-server.ts`): sign in, reconnect on claude.ai, failed, duplicates of a server with the same name that connects, then **Ready** and **Off** folded; an origin tag shows only when two servers share a name.
- Settings, MCP servers (`/settings/mcp-servers`) lists what a chat in the open workstream, or the home folder, connects, grouped by origin, with a switch per server.
- **Fix N** in both opens one global dialog that walks sign-ins, claude.ai connectors and failures in that order, starting each step as it comes up, moving on when `chat:mcp-server-changed` reports the server connected, and cancelling a waiting sign-in on **Skip**, **Turn off** or close.

## Consequences

A sign-in from any chat, the Settings page or the fix flow reaches every open chat, and a turned-off server leaves the terminal's Claude Code too, as a skill turned off on the Skills page does.
The Settings page costs a probe Claude Code that connects every server, a few seconds per visit.
A server turned off there disappears from Claude Code's own lists, so Malini lists it from `deniedMcpServers`.
A sign-in from a popover row still waits up to 5 minutes for the browser, since only the fix flow cancels.
`mcp-servers.test.ts` (bridge and main), `cli.test.ts` and `chat/domain/mcp-server.test.ts` cover the probe, the protocol, the deny list and the grouping; `tests/e2e/mcp-servers.spec.ts` and `session-status.spec.ts` drive the popover, the fix flow, skipping a sign-in and the Settings page against the fake bridge; `pnpm check` fails when either side of the protocol or the event reference is stale.
