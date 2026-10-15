export type SkillSource = 'personal' | 'repository' | 'plugin' | 'claude-code' | 'other';

export type SkillRecord = Readonly<{
	name: string;
	description: string;
	source: SkillSource;
	tokens: number;
}>;

export type SkillPresetRecord = Readonly<{
	id: string;
	name: string;
	skills: readonly string[];
	isDefault: boolean;
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
	skills: readonly string[];
}>;

export type SkillPresetIdArgs = Readonly<{ presetId: string }>;

export type DefaultSkillPresetArgs = Readonly<{ presetId: string | null }>;

export type SkillChoiceScopeArgs = Readonly<{ workstreamId: string; sessionId?: string }>;

export type ChooseSkillsArgs = Readonly<{
	workstreamId: string;
	sessionId?: string;
	choice: SkillChoice;
}>;

export const SKILL_PRESET_NAME_MAX_LENGTH = 40;

export const SKILL_PRESET_MAX_SKILLS = 500;

export const SKILL_NAME_MAX_LENGTH = 200;
