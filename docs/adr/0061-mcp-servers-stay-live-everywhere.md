# 0061 - MCP servers stay live everywhere

Status: accepted

## Context

0057 listed MCP servers on the Settings page from a probe Claude Code started per visit, which connected every server and answered only once none was pending, for up to 30 s.
The first visit after a launch showed placeholders for 3.4 s with seven fast servers, and a slow or broken server held the whole page.
Turning a server off wrote `deniedMcpServers`, which reached a chat only when its Claude Code restarted, so the page said "Off. New chats leave it out."
The user wants everything on screen to be instant, and everything shown to be true in every chat already, with no "start a new chat".
Tracer bullets against Claude Code 2.1.293 showed that neither `applyFlagSettings({ deniedMcpServers })` nor a settings file a running Claude Code watches turns a server off live, while `toggleMcpServer` does.
`toggleMcpServer(name, false)` also writes the server into `disabledMcpServers` of the folder in `~/.claude.json`, and `toggleMcpServer(name, true)` fails with "blocked by enterprise managed policy" until Claude Code has read a settings file without the deny, about a second.

## Decision

- The bridge protocol is version 36 (`packages/agent-bridge/protocol/bridge-protocol.json`).
  `list_mcp_servers` is gone; `watch_mcp_servers { cwd, restart? }` keeps one Claude Code per folder open for 90 s after the last watch and sends `bridge.mcp_servers { cwd, servers, settled, error? }` whenever what it lists changes (`watchMcpServers` in `packages/agent-bridge/src/claude/mcp-servers.ts`).
  A watch that renews an open one sends the current listing before its acknowledgement.
- The watching Claude Code restarts when the MCP part of the user's configuration changes: the settings files, `.mcp.json`, and the `mcpServers` and folder MCP keys of `~/.claude.json` (`mcpConfigSnapshot` in `config-snapshot.ts`).
  The same stamp joins a chat's config snapshot, so a chat whose MCP configuration changed restarts its Claude Code on its next prompt.
- `chat.watch-mcp-servers` (`apps/malini/src/lib/chat/platform/mcp-servers.ts`) answers at once with the folder's last listing from `mcp_server_listings`, or the newest listing of any folder without its project and local servers, and main emits `chat:mcp-servers-listed` for every change.
  Main merges a listing that is still connecting into the one it showed, so known rows keep their status until their server settles.
  The Settings page renews its watch every 30 s, and its refresh button restarts the watching Claude Code.
- `switch_mcp_server { serverName, on, folders }` runs after Turn on or off has written `deniedMcpServers`, and calls `toggleMcpServer` in every chat's Claude Code, retrying a Turn on for up to 5 s.
  A chat whose switch went live restamps its config snapshot, so its next prompt reuses the same Claude Code.
  `bridge.mcp_switched` names the folders a Turn off reached; main keeps them in `mcp_server_folder_offs`, and the next Turn on of that server toggles it back on there, in a chat's Claude Code or a short probe, so no `disabledMcpServers` entry stays behind.
  The watching Claude Code is not switched off, and the page shows the server off from the deny list.
- The grouping, the Fix flow and `deniedMcpServers` as the app-wide switch stay as 0057 decided.

## Consequences

The Settings page shows its servers in the frame it opens, about 17 ms after the click in the built app, and a turned-off server leaves an open chat's next tool call without a restart.
A turn already running when the switch lands sees the change from its next request.
While the page is open, and for 90 s after, one more Claude Code and its MCP servers stay in memory per watched folder.
0038's consequence that MCP servers in `~/.claude.json` reach a chat only after a restart no longer holds: the chat restarts on its next prompt.
`mcp-servers.test.ts`, `config-snapshot.test.ts`, `session.test.ts` and `cli.test.ts` in the bridge, `mcp-servers.test.ts` and `protocol.test.ts` in main, and `tests/e2e/mcp-servers.spec.ts` cover the watch, the switch, the cleanup of switched-off folders and the listing that shows at once after a relaunch; `pnpm check` fails when either side of the protocol or the event reference is stale.
