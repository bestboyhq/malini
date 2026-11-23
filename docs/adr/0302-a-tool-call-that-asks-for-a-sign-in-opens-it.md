# 0302 - A tool call that asks for a sign-in opens it

Status: accepted

## Context

0267 signs a server in inside `mcp_servers_add`, but only when the server reports `needs-auth` as it connects.
Product Hunt's server connects without a sign-in and lists its 27 tools, then refuses an account tool such as `get_my_account` with "MCP server "producthunt" needs you to sign in again (run /mcp to re-authenticate)".
Claude Code then tells the agent that the session cannot run the OAuth flow and that the user signs in with `/mcp` in a terminal, so the agent sent the user there, and the user said "Malini should handle that for me. Like people using Malini will not have Terminal running for stupid situations like that."
The chat's MCP panel and Settings, MCP servers both showed Product Hunt as connected, so neither offered **Sign in**.
A tracer against Claude Code 2.1.330 and the real Product Hunt server showed that the refused call fires `PostToolUseFailure`, that the run's `mcpServerStatus()` reports the server `needs-auth` inside that hook, and that `mcpAuthenticate` on the run's own query answers there with the provider's link and `callbackExpected: true`.

## Decision

- `ClaudeSession` registers a `PostToolUseFailure` callback, `#signInWhenAsked`, on every query, with no matcher and a timeout of `AUTHORIZATION_WINDOW_MS` plus 60 s.
  Claude Code reads a matcher of only word characters as one exact tool name, so the callback checks for `mcp__` itself.
- When the failed tool's server, found by `mcpToolPrefix`, is `needs-auth` in the run, the callback runs the same `#signIn` that `mcp_servers_add` runs: `signInMcpServer` on the run's query, the link opened with `/usr/bin/open`, then a wait of up to 5 minutes for `connected`.
- `#signIn` shares one sign-in per server name while it runs, so calls that fail together open one page.
- The callback answers with `additionalContext`: that the tool failed because the server needs a sign-in, then, as `mcp_servers_add` does, that it is connected with its tool count, that the user did not finish within 5 minutes and that calling the tool again opens the page again, or why the sign-in did not start.
  Either way the session then reports the run's MCP status, so the chat's MCP panel shows the server as it is.
- The callback also gives the failed row its text through `Transcript.noteFailure`, which the `tool.failed` for that `tool_use_id` carries as its `error` in place of Claude Code's "(run /mcp to re-authenticate)".
  Claude Code waits for the callback before it sends the tool result, so the note is in place when the transcript maps it.
- No bridge command or event changes, so the protocol stays the same.

## Consequences

- A server that asks for a sign-in only on some tools now signs in from the chat, with the provider's consent page as the only step, and the agent retries in the same turn.
- A refused call holds its turn for up to 5 minutes while the page is open, as an add does under 0267; a run with nobody there goes on after that.
- Settings, MCP servers still shows such a server as connected, with no **Sign in**, since its probe connects without one.
- The failed row says what Malini did, never a terminal command the user of a desktop app has no reason to run.
- Enforced by `session.test.ts` (a `PostToolUseFailure` on a `needs-auth` server's tool opens the link once, connects, tells the agent to call it again, gives the failed row Malini's note and reports the server connected); the tracer is not checked in.
