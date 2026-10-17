# 0015 - Every model has a name

Status: accepted

## Context

Claude Code lists a `default` alias first among its models, `Default (recommended)`, which resolves to whatever model it recommends for the account at that moment.
malini showed it as `Default` in the model picker, made it the implementation model and the model of new jobs, and stored it on 148 chats and 2 jobs in the maintainer's own database.
The user's words: "default is hiding something"; a chat that says `Default` does not say which model answered, and what it means changes under the user without a trace.
The SDK reports each entry's `resolvedModel`, and `default` resolved to `claude-opus-5-5`, the same model as `opus`, so the alias added nothing a name could not say.

## Decision

- The bridge drops Claude Code's `default` entry from the models it reports (`isNamedModel` in `packages/agent-bridge/src/claude/capabilities.ts`), and always passes the chosen model to the SDK; `session.ts`, `titles.ts` and `presets.ts` no longer special-case it.
- `packages/agent-bridge/protocol/bridge-protocol.json` sets `defaultModel` to `opus` and the fallback `models` to `opus`, `sonnet` and `haiku`.
- `isValidAgentModel` in `src/lib/shared/providers/domain/model-id.ts` rejects `default`, so no command, job or preference can store it again.
- Migration v46 rewrites `default` to `opus` in `agent_sessions` and `job_definitions`.
  Renderer storage repairs on read: model preferences fall back to the saved defaults, and a queued prompt keeps its place under `opus` through `persistedAgentModel`.
- With both modes now on `opus` by default, activating a chat infers Plan or Agent from its model only when the model matches exactly one mode's choice; otherwise it keeps the stored mode.

## Consequences

- The picker, the composer and the settings show the model that runs: Fable, Opus, Sonnet or Haiku, each with Claude Code's own description and version.
- malini no longer follows Claude Code's recommendation on its own; when a better model ships, the user picks it, or a change to `defaultModel` names it.
- An account whose Claude Code lists no `opus` still sees Opus first, because the bridge adds the fallback entry for `defaultModel`.
- Enforced by `model-id.test.ts` (rejects `default`), `capabilities.test.ts` (the probe drops the alias), the v46 case in `migrations.test.ts`, `prompt-queue.aggregate.svelte.test.ts`, and `tests/e2e/model-picker.spec.ts` (the picker reads `Model: Opus`).
