# 0049 - A job names its own skills

Status: accepted

## Context

ADR 0015 kept skill presets for jobs only, built on Settings → Jobs by dragging skills into named groups with an emoji.
Only jobs used them, so a preset was a second object to name, fill and keep in sync just to say which skills one job loads.
The user decided Malini does not need presets: a job can carry the skills it knows of.
The SDK's `skills` option and the per-session list the job runner hands it stay as they were.

## Decision

- A job definition carries `skills`, a list of skill names (`job_definitions.skills`, JSON); an empty list loads every skill that is on.
- The job editor picks them with the hyper-ui `Autocomplete` over the skill catalog (`SkillsField` in `src/lib/skills/presentation`); Settings → Jobs has no presets board.
- The job runner writes a job's list to its session (`chooseSessionSkills` in `src/lib/skills/platform/session-skills.repository.ts`), and `skillsForRun` reads it before every `send_prompt`.
- `jobs_save` takes `skills`, and `jobs_list` returns them, so an agent can name a job's skills too.
- Migration 55 copies each job's preset into its `skills`, turns every job session's choice into its plain list, drops `skill_preset_id` and the `skill_presets` table, and removes the `skills.*-preset` commands.
  It is the first migration on top of the v54 baseline; `migrate` now runs the baseline schema for a new database and every later migration in order.
- Everything else in 0015 stands: chats load every skill that is on, and Settings → Skills ranks skills by use and turns them off in Claude Code's settings.

## Consequences

- One place says what a job loads: the job itself.
- Two jobs that share skills list them twice; a renamed skill has to be renamed in each job that names it.
- A job that names a skill no longer installed keeps the name, and the SDK simply finds no such skill.
- Enforced by `src/main/db/migrations.test.ts` (v55 keeps each job's skills), `src/lib/jobs/platform/register.test.ts` (save, keep and run with a job's skills), `src/lib/chat/platform/agent/service.test.ts` (`jobs_save` and `jobs_list` carry skills), and `tests/e2e/skills.spec.ts` (the editor picks skills and the job's agent loads only those).
