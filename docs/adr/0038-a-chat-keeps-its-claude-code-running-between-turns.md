# 0038 - A chat keeps its Claude Code running between turns

Status: accepted

## Context

The bridge started a new Claude Code process, resuming the conversation, for every prompt and closed it when the turn ended, so every turn reconnected every MCP server.
Claude Code does not wait for MCP servers before it answers: a probe on Claude Code 2.1.293 showed `system/init` at 280 ms with Svelte still pending and no claude.ai connector listed yet, and every server connected only at 1.75 s.
On a resume, the servers the transcript had already announced but that had not reconnected yet were reported disconnected, with an instruction not to search for them, so the agent lost tools it had used a turn earlier; the user saw "a bunch of tools or MCPs" fail to load sometimes.
The MCPs popover showed only that init snapshot, so a server read "connecting" for the whole run, and `chat.refresh-mcp-status` was never called and sent a run id main could not route.
The context popover was stale the same way: its breakdown and plan limits were read once, when a turn ended, and the user felt both popovers lag.
A second probe showed that a live Claude Code does not reread `CLAUDE.md` or `.mcp.json`, so an edit between turns reaches only a new process.
One Claude Code per repository was considered: a process is one conversation with one cwd, permission mode, model and sandbox that runs one turn at a time, so it cannot serve parallel chats in separate worktrees.

## Decision

- After a turn ends, the bridge keeps the chat's query open and pushes the next prompt into it (`packages/agent-bridge/src/claude/session.ts`, `#rest` and `#continue`).
  That needs the same access level, mode, report resolution and skills (`canContinue`) and no change to the watched files.
- The watched files are the memory files Claude Code reports through `getContextUsage().memoryFiles`, the user and project settings, `.mcp.json`, and `CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md` and `AGENTS.md` in the worktree, compared by modification time and size (`config-snapshot.ts`).
  A change starts a new process that resumes the conversation.
- An idle Claude Code closes after 10 minutes, on any message it sends while idle, since a turn of its own would run outside every Malini run (0009), and when the chat closes, undoes or steers with other settings.
  Stop still ends Claude Code and its background work (0017).
- A new process holds the first prompt in the SDK's input until every MCP server the chat saw before is listed and none is pending, for up to 5 s.
  A stop during that wait ends the input, so the prompt never reaches Claude Code.
- `refresh_mcp_status` becomes `refresh_session_status` (`chat.refresh-session-status`) and carries only the session.
  The bridge answers for the chat's current or last run with `mcp.status` and an interim `usage.updated` holding Claude Code's own `getContextUsage()` reading, its breakdown and the plan limits; that reading matched the API usage of the last turn to within 3 tokens in a probe.
  The renderer refreshes when the MCPs or the context popover opens, and an interim reading's breakdown and plan limits replace the ones the last turn left.
  The bridge protocol is version 30.

## Consequences

- MCP servers connect once per process: every turn after the first starts with all of them and without a process start.
- The popovers are live only while a chat's Claude Code runs; after it closes they show what the last turn left.
- Each chat used in the last 10 minutes holds one Claude Code and its MCP servers in memory; the stats panel lists them as Claude Code.
- User and local MCP servers in `~/.claude.json` reach a running Claude Code only once it restarts, because Claude Code rewrites that file all the time.
- A new process can wait up to 5 s for a slow server, and a server Claude Code lists late can still miss the first turn of a new chat.
- Enforced by the bridge tests in `session.test.ts` that send a second prompt into the same query, restart it after `CLAUDE.md` changes, close it when it stirs while idle or after ten idle minutes, hold the first prompt for a pending server, drop a prompt stopped in that wait, and refresh the live MCP status and context, and by `tests/e2e/session-status.spec.ts`.
