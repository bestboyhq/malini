# 0301 - Widgets read MCP servers, not scripts

Status: accepted

## Context

0298 let a widget's `command` source run a shell script from `.malini/widgets/`, with the repository's secrets and `MALINI_CHECKOUT`.
The first real widgets, Visitors and Rounds by region in a game repository, each needed a script that called an analytics API with a key the user had to save first.
Simon judged that path too costly: "for the CLI there will be a lot of friction for someone to add it, also for the repo to maintain it", while "someone will just go and add MCP in Malini and Malini already has live MCP servers".
He set the bar: "we should do MCP only unless we can provide a frictionless sign-in experience for CLI", because Malini already has MCP sign-in and management, "and if we cannot get that for CLI, then we should not tolerate it".
A script also gave every teammate who placed a shared widget whatever the default branch's script did, on their Mac.
This amends 0298: the `command` source, its helper files and its secrets go, and a widget reads an MCP tool instead.

## Decision

- A widget source is `mcp`, `github` or the built-in `plan`.
  In a widget file, `{ "mcp": { "server", "tool", "arguments", "url"? }, "select"? }`; `widget-files.ts` parses it, `sourceFile` writes it, and `WidgetSource` in `$contract/widgets` carries it as `kind: 'mcp'`.
- **Calling.**
  `readWidgetSource` in `widgets/platform/widget-sources.ts` calls the `mcp` dependency, which `modules.ts` wires to the chat platform's `callMcpTool`.
  The bridge answers `call_mcp_tool` with Claude Code's `mcp_call` control request in the workstream's checkout, so the call uses the same servers, sign-ins and turned-off list as the chat there, with no model turn.
  Only a tool whose server marks it `readOnly` runs; any other answers `not-read-only`, because a shared widget runs on every teammate's board with no approval.
- **Shaping.**
  `select` runs as `jq -c <select> <file>` on the tool's text answer, through `runBounded` with the 20-second source deadline, and a missing `jq` says so.
  macOS 15 and later ship `/usr/bin/jq`.
- **Needs.**
  The migration at user version 121 adds `widget_readings.need`, one of `WIDGET_NEEDS`: `add` when the server is not one of the user's, `sign-in` when it needs a sign-in, `turn-on` when the user turned it off.
  Claude Code does not list a server in `deniedMcpServers` at all, so `McpServerListings.callTool` answers `off` for a `missing` server that the user turned off in Malini.
  The tile shows the error with one button: **Add <server>** starts a workstream whose prompt asks the agent to add the server with `mcp_servers_add` at the widget's `url`, **Sign in to <server>** opens **Fix MCP servers** with that one step, and **Turn on <server>** switches it on.
  A watched widget with a need reads again once `chat:mcp-server-changed` or `chat:mcp-servers-listed` shows its server connected.
- **No scripts.**
  `widgets_save` refuses `command`, the bridge schema has no `command`, and the mine store, `materializeShared` and **Make default** copy only `.json` files.
  A widget file with `command` still parses, so a placed one stays on the board and its reading says "Widgets read MCP servers now, not scripts. Ask the agent to move this one."
  It reads at once on every board plan and drops the numbers its script printed before, so the tile never shows numbers that will not change again.
- A tile whose last read failed over older numbers keeps them dimmed and shows a warning sign in its header with the error.
  The widgets platform no longer takes `secrets`.
- `github` sources stay: Malini installs `gh` itself (0218) and signs it in, so they already meet the bar.
- An automation whose internet is off may not save any widget, since both sources reach the network.

## Consequences

- A widget needs no key, no script and no repository code: a teammate with the same MCP server reads the same widget, and one without it gets **Add**.
- A shared widget can no longer run arbitrary code on a teammate's Mac; it can only call a read-only tool of a server that teammate added and signed in to.
- A source an MCP server does not expose cannot be a widget until someone adds a server for it.
- A read starts the workstream's Claude Code bridge session when none runs, the same session the chat's MCP status uses.
- Enforced by `src/lib/widgets/platform/register.test.ts` on real SQLite, git and jq (the call and its arguments, `select`, each need, the refused tool that writes, the refused `command`, a script widget from main shown as a failed read, the re-read once the server connects), the bridge's `call_mcp_tool` tests, `packages/agent-bridge/src/claude/browser-tools.test.ts` (the schema takes `mcp` and refuses `command`), `src/main/db/migrations.test.ts`, and the widget e2e specs on the fake bridge's MCP tools.
