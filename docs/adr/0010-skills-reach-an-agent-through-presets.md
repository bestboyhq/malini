# 0010 - Skills reach an agent through presets

Status: accepted

## Context

ADR 0005 lets every run load every skill Claude Code finds: personal, repository, plugin and built-in.
On the user's Mac that is 47 skills and about 7,400 tokens in every chat, whatever the chat is for, and nothing in malini showed which skills an agent had.
The user wants to pick, for each chat and each job, the skills its agent loads, from any source, without naming them in every prompt.
The Claude Agent SDK's `skills` option filters the skills a run sees, and `getContextUsage()` reports every skill with its source and token cost.

## Decision

- A skill preset is a named list of skill names, stored in malini's database (`skill_presets`, migration 44); at most one preset is the default for new chats.
- A chat's choice is `default`, `all`, a preset, or a custom list (`SkillChoice` in `src/contract/skills.ts`), stored per workstream and, for job sessions, per session (`skill_choices`).
- Before every `send_prompt`, the main process resolves the skills of the run in `skillsForRun` (`src/lib/skills/platform/skill-resolution.ts`): the session's choice, else the workstream's, else the default preset, else every skill.
  The bridge passes the list to the SDK's `skills` option; no list means every skill, as before.
- A job definition carries a `skill_preset_id`; the job runner gives the job's session that preset before it sends the prompt.
- malini learns which skills exist from Claude Code itself: the bridge's `list_skills` command opens an idle `query()` in a folder with every skill on and answers with each skill's name, description, source and tokens (bridge protocol v22).
- The composer shows the chat's preset and skill count at all times, the setup flow and Settings → Skills group skills into presets by drag and drop, and the job editor picks a job's preset.

## Consequences

- A chat loads only the skills its work needs, and the composer says which.
- New skills a user installs stay out of every preset until they add them; the All skills choice keeps the old behavior.
- The filter is a context filter, not a sandbox: an unlisted skill is hidden from the model and refused by the Skill tool, but its files stay readable.
- Preset names are stored, not skill folders, so a repository skill in a preset applies wherever a repository with that skill is open.
- Enforced by `src/lib/skills/platform/register.test.ts` (resolution order, presets, choices), `src/lib/chat/platform/agent/commands.test.ts` (a prompt carries its chat's skills), `packages/agent-bridge/src/claude/session.test.ts` (the SDK gets the list), and `tests/e2e/skills.spec.ts` (a chat's agent sees only its preset's skills).
