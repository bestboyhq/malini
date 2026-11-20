# 0267 - An added MCP server signs in inside the call that adds it

Status: accepted

## Context

0265 lets an agent add an MCP server in a turn, but a server in `needs-auth` came back to the agent as "It needs a sign-in, which the user does in Settings, MCP servers."
Adding Product Hunt's OAuth server sent the user to Settings and back, and the user said "now that we have a super smooth MCP installation flow, can you also make it super smooth to authorize into a newly added MCP from within Malini without some bullshit like switching things in settings".
A tracer against Claude Code 2.1.329 and Agent SDK 0.3.290, with a local OAuth MCP server, showed that the run's own `Query.mcpAuthenticate` signs in a server that `setMcpServers` added mid-turn: it answers with an `authUrl` and `callbackExpected`, its own callback listener takes the redirect, and the server turns `connected` with its tools within a second.
A fresh Claude Code that loads the saved user-scope entry then finds the same token and connects, so one sign-in covers every chat and the terminal.
Claude Code waits 1e8 ms on a call to an MCP tool unless `MCP_TOOL_TIMEOUT` says otherwise, so a tool call can wait for a person.

## Decision

- `ClaudeSession#addMcpServer` saves a `needs-auth` server as before, then `#signIn` reports the run's MCP status, so the chat's MCP panel lists the server with **Sign in**, and calls `signInMcpServer` in `packages/agent-bridge/src/claude/mcp-servers.ts` on the run's own query.
- `signInMcpServer` is the part of `startMcpAuthorization` after the probe opens: `mcpAuthenticate`, then `settle` until the server is `connected`, for `AUTHORIZATION_WINDOW_MS` (5 minutes) when there is a link, cancelled by the run's `abort` signal.
  The Settings and panel **Sign in** flow (`authorize_mcp_server`) calls the same function on its probe.
- The bridge opens the link in the default browser with `openInBrowser`, which runs `/usr/bin/open`; `authentication` already refuses a link that is not `http` or `https`.
  `ClaudeSessionOptions.openUrl` replaces it, and tests pass a fake.
- The call answers once the server connects, with its tool count, so the agent uses it in the same turn.
  When the window ends first it says the user did not finish and that calling `mcp_servers_add` again opens the page again; when the sign-in cannot start it says why.
  Either way the server stays saved.
- A **Sign in** pressed in the panel while the call waits still works: its probe signs in, every open chat reconnects the server through `adoptMcpServer`, and the waiting call sees it connect.
- No bridge command or event changes, so the protocol stays at 60.

## Consequences

- Adding an OAuth server is one card, or none once always allowed, then the provider's own consent page in the browser the user is signed in to.
- The browser opens without a click after the card, even for an always-allowed call; a run with nobody there holds its turn for up to 5 minutes, then goes on.
- The bridge now opens a URL itself, macOS only like the rest of Malini, rather than asking main for `shell.openExternal`.
- Enforced by `session.test.ts` (a remote server in `needs-auth` opens the link, connects in the same call, is saved and reported connected); the tracer is not checked in.
