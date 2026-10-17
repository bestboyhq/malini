---
name: claude-runtime
description: How malini drives Claude Code through the Claude Agent SDK. Use when changing the bridge's Claude adapter, bumping the SDK, mapping a new SDK message or tool, or debugging a run that behaves differently from the `claude` CLI.
---

# Claude runtime

malini runs no agent loop of its own.
The bridge (`packages/agent-bridge`, a child process on Electron's binary) hands each prompt to the user's installed `claude` through the SDK's `query()` and translates the stream into malini's bridge events.

## Who owns what

Claude Code owns the loop: tools, compaction, skills, `CLAUDE.md`, hooks, MCP, and model access through the user's own login.
`settingSources` loads the user, project, and local settings, so a run behaves like `claude` in a terminal.
The one exception is skills: `send_prompt` carries the skill names of a job's preset (ADR 0015), and the session passes them to the SDK's `skills` option; no list, as in every chat, means every skill that is on.

malini owns the rest, and the adapter enforces it:

- Git history: `disallowedTools` refuses the commands in `MALINI_OWNED_GIT_COMMANDS` and every stash write, but not reads or file-level `git restore`; the agent leaves changes in the working tree and names the commit in its last message.
  Claude Code matches each part of a compound command, so one refused part denies the whole command.
- Approvals and questions: every `canUseTool` call becomes a malini interaction; `AskUserQuestion` answers return as `updatedInput.answers`, keyed by question text.
  A user's deny returns `interrupt: true`, so the run stops the way it does in the `claude` CLI and ends as cancelled.
- Plans: `ExitPlanMode` is denied with a hand-off message, and the plan goes to malini's UI, which starts the implementation.
- Conversation: Claude's session id is malini's provider session id.
  Undo resumes with `resumeSessionAt`; a missing transcript falls back to a fresh conversation seeded with malini's own history.
- Turn binding: each prompt carries a uuid, and the run ends on the result whose `user_message_uuids` names it.
  Claude Code also runs turns of its own: a resume that finds a background agent the last process left unfinished first reports it in an empty zero-turn result.
- Background work: the run stays open while `background_tasks_changed` lists a task that is not `ambient`, and Claude Code's own follow-up turn after a task ends belongs to that run.
  The bridge reports the live tasks as `background.updated`; a prompt that arrives while the run only waits is pushed into the same query and takes the run over (`docs/adr/0009-a-run-stays-open-while-its-background-work-runs.md`).

`src/claude/` holds one file per concern: `session.ts` (options and run lifecycle), `transcript.ts` (messages to events), `permissions.ts` (access profiles to permission mode and sandbox), `instructions.ts`, `installation.ts`, `capabilities.ts`, `skills.ts` (an idle query with every skill on, read through `initializationResult()` and `getContextUsage()`, that answers `list_skills` with each skill's name, description, source and tokens, and turns the skills and plugins in `turnedOff` back on through flag settings for that query alone), `titles.ts` (a one-turn, tool-less query that names a chat and its workstream from the first prompt, with the instructions and model of the built-in Name chats job that `suggest_title` carries).

## Shapes come from tracer bullets

Map only shapes you have seen the real SDK emit; the `.d.ts` lists what may arrive, not what a run sends or in what order.
Fire a tracer bullet from a scratch directory, since the agent really runs its tools there:

```sh
W=$PWD; S=$(mktemp -d); mkdir "$S/cwd" && cd "$S/cwd"
node "$W/.agents/skills/claude-runtime/scripts/record.mjs" 'Create probe.txt containing x, then run ls.' default > ../write.json
```

It records every message and `canUseTool` call in the `ScriptStep` format, on the user's subscription with `haiku` unless `MODEL` says otherwise.
Other tools are allowed; `DECISION=deny` denies them the way malini does, which records the `deny` scenario.
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
3. `corepack pnpm --filter @malini/agent-bridge test`, then `pnpm check`.
4. The packaged app copies the SDK's dependency closure into `dist/node_modules` (`scripts/copy-runtime-dependencies.mjs`); run `pnpm dist` once and send a prompt from the built `.app`.

Done when a prompt, a tool approval, a question, and a plan each complete in the built app, proven with the test-malini-app skill.
