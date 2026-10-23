# 0040 - MCP servers sign in through a Claude Code probe

Status: superseded by 0057

## Context

The MCPs popover (0038) showed servers that failed or needed authentication with a sentence about it and no way to act, so the user had to leave Malini and run `/mcp` in a terminal.
The Agent SDK types list `reconnectMcpServer` but no sign-in; its `Query` class still has `mcpAuthenticate(serverName, redirectUri)`, which sends the `mcp_authenticate` control request.
A probe on Claude Code 2.1.293 returned `{ authUrl, requiresUserAction, callbackExpected, callbackPort }` for a plugin's HTTP server: Claude Code opens no browser itself, listens for the OAuth callback on localhost and reconnects the server once it arrives.
A claude.ai connector answers with a claude.ai link and `callbackExpected: false`, so nothing tells Claude Code when that sign-in ends.
A chat's own Claude Code closes after 10 idle minutes (0038), so a sign-in that needs it fails in any chat the user returns to later, and keeping it open longer would hold a process per chat for one rare action.

## Decision

- **Sign in** in the MCPs popover runs `chat.authorize-mcp-server`, which sends the bridge `authorize_mcp_server`; the bridge answers with a `bridge.mcp_authorization` frame carrying the link, and the renderer opens it through `app.open-external-url`.
- The bridge opens a probe Claude Code in the chat's worktree with the user, project and local settings, hooks off and no session file, and calls `mcpAuthenticate` on it (`packages/agent-bridge/src/claude/mcp-servers.ts`).
  The probe stays open until that server reads connected, for up to 5 minutes; for a claude.ai connector it calls `reconnectMcpServer` every 3 s while it waits.
- Once the server connects, the chat's own Claude Code, if one is open, reconnects it and the bridge refreshes the session status; otherwise the bridge marks the server connected in the chat's last `mcp.status`.
- **Retry** on a failed server runs `chat.reconnect-mcp-server`: the chat's open Claude Code reconnects it, or a probe reports what a fresh connection reads.
- Both commands wait up to 60 s for their acknowledgement, since a probe starts a Claude Code first.
  The bridge protocol is version 31.

## Consequences

The user signs in to an MCP server from the chat, in any chat, without a terminal.
A sign-in costs a second Claude Code process for as long as the user takes in the browser, and the probe connects every configured MCP server while it runs.
`mcpAuthenticate` is not in the SDK's types, so `ClaudeQuery` declares it optional and the bridge refuses with an update-Claude-Code message when it is missing; an SDK bump confirms the answer's shape with a tracer bullet, as the `claude-runtime` skill says.
`mcp-servers.test.ts` checks that a sign-in hands back the link and keeps the probe open until the server connects, and `session-status.spec.ts` drives Sign in and Retry end to end against the fake bridge.
