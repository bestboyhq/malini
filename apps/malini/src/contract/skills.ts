export type SkillSource = 'personal' | 'repository' | 'plugin' | 'claude-code' | 'other';

export type SkillRecord = Readonly<{
	name: string;
	description: string;
	source: SkillSource;
	tokens: number;
	repositories?: readonly string[];
}>;

export type ListSkillsArgs = Readonly<{ workstreamId?: string }>;

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

export const JOB_MAX_SKILLS = 500;

export const SKILL_NAME_MAX_LENGTH = 200;

export function isSkillNameList(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.length <= JOB_MAX_SKILLS &&
		value.every(
			(name) =>
				typeof name === 'string' && name.trim().length > 0 && name.length <= SKILL_NAME_MAX_LENGTH,
		)
	);
}
