# 0015 - Skills are kept tidy by use, not picked per chat

Status: accepted

## Context

ADR 0012 put a preset picker in every composer and ADR 0013 made setup sort every skill into presets.
The user found it far too visible: with many skills and plugins whose origin they did not know, building presets was a chore nobody wants, and good UX is the invisible kind.
They asked instead for a view of which skills their agents actually use, from most to least, so they can clean up the set itself.
Claude Code already counts every skill dispatch, slash commands included, in `skillUsage` (`usageCount`, `lastUsedAt`) in `~/.claude.json`, and hides a skill everywhere with `skillOverrides: { "<name>": "off" }` in `~/.claude/settings.json`.
Plugin skills cannot be turned off one by one; a plugin turns off as a whole with `enabledPlugins: { "<name>@<marketplace>": false }`.
Flag settings passed to the SDK win over the user's, so a listing query can still see what the user turned off.

## Decision

- A chat loads every skill that is on; the composer has no skill control, and only a job session narrows its skills to the job's preset (`skillsForRun(db, sessionId)` in `src/lib/skills/platform/skill-resolution.ts`).
- Settings → Skills (`SkillUsageList`) ranks skills and plugins by Claude Code's `skillUsage`, with a heat cell, last use, token cost, origin (repository, plugin marketplace) and an on/off switch, and says how many skills that are on were never used.
- `skills.usage` reads `skillUsage`, `firstStartTime`, `skillOverrides` and `enabledPlugins`; `skills.switch` writes `skillOverrides` for a skill and `enabledPlugins` for a plugin the settings already name, through `atomicReplaceFile` on the real path of a symlinked file (`src/lib/skills/platform/claude-settings.ts`).
  Both resolve `CLAUDE_CONFIG_DIR` from the login shell environment the bridge gets, else `~/.claude` and `~/.claude.json`.
- `list_skills` carries `turnedOff` (bridge protocol v25), and the bridge turns those skills and plugins back on through flag settings for the listing query alone, so a turned-off row keeps its source, description and tokens.
- Presets stay for jobs only, edited on Settings → Jobs; there is no default preset and no per-workstream choice.
- Setup has no skills step, and the Suggest skill presets job, its `suggest_presets` bridge command and its `skills.suggest-presets` command are gone.
  Migration 46 deletes that job and its runs, drops `skill_presets.is_default`, and deletes per-workstream skill choices.

## Consequences

- Nothing about skills stands between the user and a chat; tidying happens in one place, when they choose to.
- Turning a skill off is global: it leaves every chat, every repository and the `claude` CLI, and malini says so in the section's description.
- malini writes the user's Claude Code settings file; it refuses a file that is not JSON, keeps every other key, and writes two-space JSON as Claude Code does, so a file Claude Code wrote comes back byte-identical after a switch off and on.
- Uses come from Claude Code's own counters, which are internal state, not a documented API; a missing or reshaped `skillUsage` shows every skill as never used rather than failing.
- Enforced by `src/lib/skills/platform/register.test.ts` (settings reads and writes, symlinks, refusals, run resolution), `src/lib/skills/domain/skill-usage.test.ts` (ranking, heat, plugin switches), `packages/agent-bridge/src/claude/skills.test.ts` and `src/__tests__/protocol.test.ts` (`turnedOff`), `src/main/db/migrations.test.ts` (v46), and `tests/e2e/skills.spec.ts` (setup without a skills step, Settings → Skills writing the settings file, presets on Settings → Jobs).
