---
name: claude-runtime
description: How Malini drives Claude Code through the Claude Agent SDK. Use when changing the bridge's Claude adapter, bumping the SDK, mapping a new SDK message or tool, or debugging a run that behaves differently from the `claude` CLI.
---

# Claude runtime

Malini runs no agent loop of its own.
The bridge (`packages/agent-bridge`, a child process on Electron's binary) hands each prompt to the user's installed `claude` through the SDK's `query()` and translates the stream into Malini's bridge events.

## Who owns what

Claude Code owns the loop: tools, compaction, skills, `CLAUDE.md`, hooks, MCP, and model access through the user's own login.
`settingSources` loads the user, project, and local settings, so a run behaves like `claude` in a terminal.
The one exception is skills: `send_prompt` carries the skills a job names (ADR 0049), and the session passes them to the SDK's `skills` option; no list, as in every chat, means every skill that is on.

Malini owns the rest, and the adapter enforces it:

- Git history: `disallowedTools` refuses the commands in `MALINI_OWNED_GIT_COMMANDS` and every stash write, but not reads or file-level `git restore`; the agent leaves changes in the working tree and names the commit in its last message.
  Claude Code matches each part of a compound command, so one refused part denies the whole command.
- Approvals and questions: every `canUseTool` call becomes a Malini interaction; `AskUserQuestion` answers return as `updatedInput.answers`, keyed by question text.
  A user's deny returns `interrupt: true`, so the run stops the way it does in the `claude` CLI and ends as cancelled.
- Calls auto mode blocks: the `PermissionDenied` hook turns each classifier denial into a Malini approval carrying `autoModeRule`, and an allow answers `retry: true` while a `PreToolUse` hook lets that exact call through once.
  **Always allow** writes the rule into the user's settings (`user-settings.ts`) and applies it live with `applyFlagSettings`; keeping it blocked lets the run carry on (`docs/adr/0060-a-call-auto-mode-blocks-becomes-an-approval.md`).
- Malini's tools: the in-process `malini` MCP server (`browser-tools.ts`, `platform-tools.ts`) holds the browser tools and the job, event, repository, workstream and `files_open` tools, answered by main over `bridge.browser_request` and `bridge.platform_request`.
  The browser tools and `PRE_APPROVED_PLATFORM_TOOLS` (the read tools and `files_open`) are in `allowedTools`; each query calls `setMcpPermissionModeOverride('malini', 'default')`, so every write tool, such as `jobs_run` or `repositories_clone`, reaches `canUseTool` even in `auto` and `bypassPermissions` (`docs/adr/0029-agents-manage-jobs-and-routines-through-malini-tools.md`).
- MCP sign-in: `authorize_mcp_server` opens a probe Claude Code in the chat's worktree or a given folder and calls the SDK's untyped `mcpAuthenticate`, which answers with the link Malini opens; the probe stays open until the server connects or `cancel_mcp_authorization` closes it, then every open chat reconnects the server and the bridge sends `bridge.mcp_server`.
  `watch_mcp_servers` keeps one Claude Code per folder open for the Settings page, 90 s past its last watch, polls its `mcpServerStatus()` and sends `bridge.mcp_servers` on every change; it restarts when the MCP part of the configuration changes (`mcpConfigSnapshot`).
  Turn on and off write `deniedMcpServers` in user settings for every new Claude Code, then `switch_mcp_server` calls `toggleMcpServer` in every chat's running one; a Turn on retries while Claude Code still reads the old deny, and toggles the server back on in the folders a Turn off reached, since `toggleMcpServer` also writes the folder's `disabledMcpServers` (`mcp-servers.ts`, `docs/adr/0062-mcp-servers-stay-live-everywhere.md`).
- Plans: `ExitPlanMode` is denied with a hand-off message, and the plan goes to Malini's UI, which starts the implementation.
- Theme: `send_prompt` carries the user's theme, `light` or `dark`; the session tells the agent to capture screenshots in it and sets `MALINI_THEME`, the one `MALINI_*` variable the agent sees, since `claudeEnvironment` strips the rest (`docs/adr/0039-screenshots-follow-the-users-theme.md`).
- Conversation: Claude's session id is Malini's provider session id.
  Undo resumes with `resumeSessionAt`; a missing transcript falls back to a fresh conversation seeded with Malini's own history.
- Process lifetime: a chat's query stays open between turns, and the next prompt is pushed into it while the settings `canContinue` compares and the files `config-snapshot.ts` watches are unchanged.
  An idle query closes after 10 minutes or on any message it sends; a new one holds the first prompt until its MCP servers settle, for up to 5 s (`docs/adr/0038-a-chat-keeps-its-claude-code-running-between-turns.md`).
- Turn binding: each prompt carries a uuid, and the run ends on the result whose `user_message_uuids` names it.
  Claude Code also runs turns of its own: a resume that finds a background agent the last process left unfinished first reports it in an empty zero-turn result.
- Background work: the run stays open while `background_tasks_changed` lists a task that is not `ambient`, and Claude Code's own follow-up turn after a task ends belongs to that run.
  The bridge reports the live tasks as `background.updated`; a prompt that arrives while the run only waits is pushed into the same query and takes the run over (`docs/adr/0009-a-run-stays-open-while-its-background-work-runs.md`).
- Slash commands: a prompt that starts with `/` reaches Claude Code as typed, and its result names the prompt's uuid like any turn.
  A compaction, typed or automatic, is a `Compact` tool call: `system/status` `compacting` starts it, `compact_boundary` completes it with its `trigger`, and a `failed` `compact_result` fails it.
  `compact_metadata.post_tokens` counts only the summary, so the run's context comes from `getContextUsage()` once a compaction clears the measured usage.

`src/claude/` holds one file per concern: `session.ts` (options and run lifecycle), `transcript.ts` (messages to events), `permissions.ts` (access profiles to permission mode and sandbox), `instructions.ts`, `installation.ts`, `capabilities.ts`, `skills.ts` (an idle query with every skill on, read through `initializationResult()` and `getContextUsage()`, that answers `list_skills` with each skill's name, description, source and tokens, and turns the skills and plugins in `turnedOff` back on through flag settings for that query alone), `titles.ts` (a one-turn, tool-less query that names a chat and its workstream from the first prompt, with the instructions and model of the built-in Name chats job that `suggest_title` carries).

## Shapes come from tracer bullets

Map only shapes you have seen the real SDK emit; the `.d.ts` lists what may arrive, not what a run sends or in what order.
Fire a tracer bullet from a scratch directory, since the agent really runs its tools there:

```sh
W=$PWD; S=$(mktemp -d); mkdir "$S/cwd" && cd "$S/cwd"
node "$W/.agents/skills/claude-runtime/scripts/record.mjs" 'Create probe.txt containing x, then run ls.' default > ../write.json
```

It records every message, `canUseTool` call and `PreToolUse` and `PermissionDenied` hook call in the `ScriptStep` format, on the user's subscription with `haiku` unless `MODEL` says otherwise.
Other tools are allowed; `DECISION=deny` denies them the way Malini does, which records the `deny` scenario.
A call auto mode blocks is retried and let through the way Malini does after the user allows it.
`OPS_TOOL=1` adds an in-process `ops` MCP server whose `set_member_role` auto mode blocks when a file asks for an owner grant; with `MODEL=sonnet`, `auto` mode and a `TODO.md` asking for one, it records `autoModeBlock`.
`RESUME=<session id>` resumes an earlier probe session; `orphanedTask` resumes one whose run was killed while its background agent still ran.
Recorded runs live in `src/claude/fixtures/transcripts.json`; tests replay them through `fakeClaude`, so a new behavior gets a recorded scenario, not a hand-written one.

A failure Claude Code recovers from by itself is recorded through `scripts/fault-proxy.mjs`, which forwards to the API and cuts the first stream once it has carried `FAULT_AFTER_DELTAS` deltas of `FAULT_KIND`:

```sh
PORT=8787 FAULT_KIND=thinking_delta node "$W/.agents/skills/claude-runtime/scripts/fault-proxy.mjs" &
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 MODEL=opus node "$W/.agents/skills/claude-runtime/scripts/record.mjs" 'Reason step by step about 17 * 23, then run ls.' default > ../retried.json
```

`retriedStream` is a thought cut by an overload, which Claude Code retries after `system/api_retry`; `nonStreamingFallback` is a tool input cut with `FAULT_KIND=input_json_delta FAULT_AFTER_DELTAS=3`, which Claude Code finishes with a non-streaming request.
`FAULT_MODE=drop` drops the connection instead of sending an overload error.
Stop the proxy by its PID once the recording ends.

## Bumping the SDK

1. `corepack pnpm --filter @malini/agent-bridge update @anthropic-ai/claude-agent-sdk`.
   `minimumReleaseAge` holds back releases younger than two days.
2. Re-record every scenario in `transcripts.json` and diff the shapes against the old recording.
   Map each new or changed message before you trust the tests.
   Call `mcpAuthenticate` on a server that needs authentication from a scratch probe and check it still answers with `authUrl` and `callbackExpected`, since the SDK's types do not cover it.
3. `corepack pnpm --filter @malini/agent-bridge test`, then `pnpm check`.
4. The packaged app copies the SDK's dependency closure into `dist/node_modules` (`scripts/copy-runtime-dependencies.mjs`); run `pnpm dist` once and send a prompt from the built `.app`.

Done when a prompt, a tool approval, a question, and a plan each complete in the built app, proven with the test-malini-app skill.
