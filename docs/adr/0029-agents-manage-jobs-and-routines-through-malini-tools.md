# 0029 - Agents manage jobs and routines through Malini tools

Status: accepted

## Context

The product goal is that a user asks Malini, in a chat, to do something for them, and the agent sets it up with jobs, routines and events.
Until now the agent in a chat could reach Malini only through the browser tools of the in-process `malini` MCP server (0010), so it could not see or change a job or a routine.
Jobs and routines live in the main process, behind the `jobs.*` and `routines.*` commands, and the bridge is a separate process that must not touch the database (0005).
Saving a routine or running a job changes what Malini does on its own later, so the user must see and approve the exact input, even in the `auto` and `full` access modes.
A tracer bullet showed that in `auto` mode Claude Code's classifier approves an MCP tool that is not in `allowedTools` without calling `canUseTool`, and `bypassPermissions` never calls it.

## Decision

- Bridge protocol version 29 adds the `bridge.platform_request` control frame (`requestId`, `sessionId`, `runId`, `tool`, `input`) and the `platform_result` command (`sessionId`, `requestId`, `ok`, `text?`, `error?`), mirroring the browser request and sharing its 60 second timeout and its abandonment on cancel and close (`packages/agent-bridge/src/cli.ts`).
- `bridge-protocol.json` lists the tools in `platformTools`, and `generate-protocol.mjs` emits them as `BRIDGE_PLATFORM_TOOLS` for both sides: `jobs_list`, `jobs_save`, `jobs_run`, `routines_list`, `routines_save`, `events_list`.
- `packages/agent-bridge/src/claude/platform-tools.ts` declares them with zod schemas on the `malini` server; the session adds the active run id to each call.
- The chat platform answers in `src/lib/chat/platform/agent/platform-tools.ts`, only through `context.commands.call` and `CONTRACT_REFERENCE`, and validates the input again.
  `jobs_run` runs in the session's workstream with `chatSessionId` and `chatAfterRunId`, so the run shows in that chat; `routines_save` creates through `routines.create-draft` with `origin: 'user'`, so every new routine is a draft the user promotes.
- `allowedTools` holds the browser tools and the three read tools; the write tools are not in it.
- Each query calls `setMcpPermissionModeOverride('malini', 'default')`, which turns `auto` and `bypassPermissions` back into a prompt for the `malini` server alone, so every write reaches `canUseTool` and the approval card.
- `permissionDescriptor` names the write (`Save routine ‘Docs after merge’`), and the approval card shows the name with the trigger and steps, or the job's settings and instructions (`maliniToolApproval` in `src/lib/chat/domain/approval-request.ts`).

## Consequences

- An agent can automate on the user's behalf, and nothing it saves runs on its own until the user promotes the routine.
- Every save and run asks, in every access mode; only an allow rule the user wrote in Claude Code settings skips the prompt.
- A new platform tool needs a name in `platformTools`, a protocol version bump, a schema in the bridge and a case in the chat platform, which `pnpm check` enforces through the exhaustive `switch`.
- A Claude Code too old for `setMcpPermissionModeOverride` logs the failure to stderr, and its `auto` mode may approve a write silently.
- Enforced by `browser-tools.test.ts` (schemas, only read tools pre-approved), `session.test.ts` (the override on every query), `permissions.test.ts`, `protocol.test.ts` and `cli.test.ts` in the bridge, and `service.test.ts`, `protocol.test.ts` and `approval-request.test.ts` in the app.
