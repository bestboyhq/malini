# 0011 - malini's own agent work runs as jobs

Status: accepted

## Context

Jobs (`src/lib/jobs`) are how malini packages agent work: a name, instructions, a model and an effort, run in a workstream.
The prompt that names chats and workstreams lived in the bridge (`packages/agent-bridge/src/claude/titles.ts`) as a fixed system prompt and model, so it ran on every first message while nobody could see or change it.
The user wants malini to be jobs first: built-in work visible next to the user's own jobs, run from where the work happens, with its results in the chat it came from.

## Decision

- Every piece of agent work malini starts on its own is a built-in job: a row in `job_definitions` with a `builtin` key (`name-chats`, `fix-checks`, `update-from-main`, `address-review`), seeded from `BUILTIN_JOBS` in `src/lib/jobs/domain/builtin-jobs.ts`, editable and resettable on the Jobs page.
- The bridge holds no prompt of its own.
  `suggest_title` carries the `name-chats` job's `instructions` and `model` (bridge protocol v21), read through `chatNamingJob` in `src/lib/jobs/jobs.platform.ts`; the bridge still trims the reply to a short name.
- `name-chats` runs on the first message of a chat, never by hand: `jobs.run` refuses it, and `isRunnableJob` keeps it out of the composer's job picker and routine steps.
  The merge queue only ever runs the three `ShippingJobBuiltin` keys.
- A job run started from a chat keeps `chat_session_id` and `chat_after_run_id` (migration 43), so the transcript can show it after the turn it followed; `jobs.list-chat-runs` loads them.

## Consequences

- What a built-in job does is data the user can read and change, and Reset brings back the shipped version.
- A new kind of automatic agent work starts as a built-in job, not as a prompt inside the bridge or a platform service.
- Changing what a built-in job's prompt receives is a job change and, when it crosses the bridge, a protocol change.
- Enforced by `src/lib/jobs/platform/register.test.ts` (the seeded built-ins, the refused `name-chats` run, chat links), `packages/agent-bridge/src/__tests__/protocol.test.ts` (`suggest_title` without instructions or model is rejected), and `src/main/db/migrations.test.ts` (v43).
