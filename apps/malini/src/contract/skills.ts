export type SkillSource = 'personal' | 'repository' | 'plugin' | 'claude-code' | 'other';

export type SkillRecord = Readonly<{
	name: string;
	description: string;
	source: SkillSource;
	tokens: number;
	repositories?: readonly string[];
}>;

export type SkillPresetRecord = Readonly<{
	id: string;
	name: string;
	emoji: string | null;
	skills: readonly string[];
	createdAt: string;
	updatedAt: string;
}>;

export type SkillChoice =
	| Readonly<{ kind: 'default' }>
	| Readonly<{ kind: 'all' }>
	| Readonly<{ kind: 'preset'; presetId: string }>
	| Readonly<{ kind: 'custom'; skills: readonly string[] }>;

export type ListSkillsArgs = Readonly<{ workstreamId?: string }>;

export type SaveSkillPresetArgs = Readonly<{
	id?: string;
	name: string;
	emoji?: string | null;
	skills: readonly string[];
}>;

export type SkillPresetIdArgs = Readonly<{ presetId: string }>;

export type SkillUse = Readonly<{ name: string; uses: number; lastUsedAt: string | null }>;

export type ClaudePlugin = Readonly<{ id: string; name: string; on: boolean }>;

export type SkillUsageReport = Readonly<{
	since: string | null;
	uses: readonly SkillUse[];
	turnedOff: readonly string[];
	plugins: readonly ClaudePlugin[];
}>;

export type TurnedOffSkills = Readonly<{ skills: readonly string[]; plugins: readonly string[] }>;

export type SwitchSkillArgs = Readonly<{ kind: 'skill' | 'plugin'; name: string; on: boolean }>;

export const SKILL_PRESET_NAME_MAX_LENGTH = 40;

export const SKILL_PRESET_MAX_SKILLS = 500;

export const SKILL_NAME_MAX_LENGTH = 200;
