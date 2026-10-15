# 0011 - Setup suggests skill presets with a built-in job

Status: accepted

## Context

ADR 0010 lets the user group skills into presets, and setup asked them to drag every skill in by hand.
With 40-odd skills that is a lot of dragging before the first chat.
The user asked setup to suggest presets from the skills they already have, with a short Haiku call through the Claude Code they just signed in to.
ADR 0009 makes every piece of agent work malini starts on its own a built-in job, so the prompt cannot live in the bridge.

## Decision

- A fifth built-in job, `suggest-presets` ("Suggest skill presets", Haiku, low effort), holds the instructions in `BUILTIN_JOBS`; migration 45 adds its key to the `job_definitions.builtin` check.
- Like `name-chats`, it only runs on its own: `isAutomaticJobBuiltin` in `src/contract/jobs.ts` keeps both out of `jobs.run`, the job picker, routine steps and the merge queue.
- `skills.suggest-presets` lists skills from the same folders as `skills.list`, then sends their names and descriptions with the job's instructions and model in the bridge's `suggest_presets` command (bridge protocol v23).
- The bridge runs one tool-less `query()` with `outputFormat: { type: 'json_schema' }` and answers with a `bridge.presets` frame.
  `cleanPresetSuggestions` keeps only skill names it was sent (a plugin skill may come back by its short name), drops presets with fewer than two skills, and keeps at most five.
- Setup starts the call when it opens, so suggestions are usually ready by the skills step.
  Each shows as a dashed card listing its skills, added with one click or by dropping a skill on it.
  When Claude Code cannot answer, setup offers blank Builder and Marketer cards as before.

## Consequences

- A new user starts from presets shaped by their own skills; on the user's 43 skills the call took 7 to 14 seconds and well under a cent of usage.
- The prompt is data on the Jobs page, editable and resettable like any built-in.
- Skill names and descriptions leave the Mac only through the user's own Claude Code, like every prompt.
- Enforced by `packages/agent-bridge/src/claude/presets.test.ts` (reply cleaning), `packages/agent-bridge/src/__tests__/protocol.test.ts` (`suggest_presets` without skills, instructions or model is rejected), `src/lib/skills/platform/register.test.ts`, `src/lib/jobs/platform/register.test.ts` (seeded and refused by `jobs.run`), `src/main/db/migrations.test.ts` (v45), and `tests/e2e/skills.spec.ts` (setup adds a suggested preset and drops a skill on another).
