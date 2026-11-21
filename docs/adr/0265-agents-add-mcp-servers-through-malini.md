# 0265 - Agents add MCP servers through Malini, live in the same turn

Status: accepted

## Context

A chat asked to install the Grip MCP server ran `claude mcp add --scope user`, and the sandbox refused `~/.claude.json.lock` and `~/.claude.json.tmp.<random>`.
`~/.claude.json` is a persistence point in `sandbox.ts`, since a server saved there runs on every later launch, so 0193 keeps it closed and no card opens it.
A one-off card could not help either, as each try writes a new random tmp name, and the agent ended by handing the user a command to paste.
The user said "malini should be able to install mcp servers (with hot reload etc) on its own, im annoyed by being involved there".
A tracer against Claude Agent SDK 0.3.290 showed that `Query.setMcpServers` called from a Malini tool mid-turn connects a stdio server, and the agent finds and calls its tools in that same turn.
0062 already restarts a chat's Claude Code on its next prompt when the MCP keys of `~/.claude.json` change, and keeps it warm when the chat restamps its snapshot.

## Decision

- The `malini` MCP server gains `mcp_servers_add { name, command?, args?, env?, url?, transport?, headers? }` in `packages/agent-bridge/src/claude/platform-tools.ts`: a `command` makes a stdio server, a `url` an `http` or `sse` one, and a mix of both is refused.
- `ClaudeSession#addMcpServer` answers it in the bridge, with no bridge command, so the protocol stays at 60.
  It calls `setMcpServers` with the run's dynamic servers plus the new one, reads `mcpServerStatus`, and goes on only when the server is `connected` or `needs-auth`.
- `saveUserMcpServer` in `mcp-servers.ts` then runs the user's `claude mcp add-json --scope user`, outside the sandbox, so Claude Code writes its own config under its own lock.
  A saved server of the same name is removed first and put back when the add fails.
- A server that does not connect, or a save that fails, is dropped from the run with `setMcpServers` again, so nothing half-added stays.
- After a save the run restamps its config snapshot with `restamped`, so the chat that added the server keeps its Claude Code, and every other chat restarts on its next prompt through 0062.
- The tool is a Malini write tool (`mcp__malini__mcp_servers_add` in `MALINI_WRITE_TOOLS`): it asks on a card that shows what it runs or reaches and the names, never the values, of `env` and `headers`, and **Always allow** remembers it as the `mcp-servers.add` action.
- Main records the call for Activity from its `tool.completed` or `tool.failed` event, with the approval it finds as `approval-<toolCallId>` (`recordBridgeAnsweredCall` in `malini-approvals.service.ts`), since no platform request reaches main; a denied call is recorded as before.
- A run whose boundary closes the internet refuses the tool, and the name `malini` is refused.

## Consequences

- The agent installs a server and uses it in the same turn, and the user answers one card, or none once they always allow it.
- An always-allowed agent can save a command that runs on every later launch outside a chat's sandbox, such as in `claude` in a terminal; the card and Settings, Agent access, which lists and revokes the grant, are the guard.
- `env` and `headers` land in `~/.claude.json` as plain text, and the tool's description tells the agent to put no secret there.
- Enforced by `session.test.ts` (live connect, save, replace, restamp with one run, no save on a failed connect, the old entry restored on a failed save), `browser-tools.test.ts` (input shapes), `approval-request.test.ts` and `malini-approvals.service.test.ts` (the card and the grant), and `agent-actions.spec.ts` (the card without env values, Allow everywhere, the next add without a card, both calls in Activity, the grant in Settings).
