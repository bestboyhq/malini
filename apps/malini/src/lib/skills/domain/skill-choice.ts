import {
	SKILL_NAME_MAX_LENGTH,
	SKILL_PRESET_MAX_SKILLS,
	type SkillChoice,
	type SkillPresetRecord,
} from '$contract/skills';

export type ResolvedSkills = Readonly<{
	skills: readonly string[] | 'all';
	preset: SkillPresetRecord | null;
}>;

export const DEFAULT_SKILL_CHOICE: SkillChoice = { kind: 'default' };

export function skillChoiceKey(workstreamId: string, sessionId: string | null): string {
	return `${workstreamId}:${sessionId ?? ''}`;
}

export function resolveSkillChoice(
	choice: SkillChoice,
	presets: readonly SkillPresetRecord[],
): ResolvedSkills {
	if (choice.kind === 'all') return { skills: 'all', preset: null };
	if (choice.kind === 'custom') return { skills: choice.skills, preset: null };
	const chosen =
		choice.kind === 'preset' ? presets.find(({ id }) => id === choice.presetId) : undefined;
	const preset = chosen ?? defaultSkillPreset(presets);
	return preset ? { skills: preset.skills, preset } : { skills: 'all', preset: null };
}

export function defaultSkillPreset(
	presets: readonly SkillPresetRecord[],
): SkillPresetRecord | null {
	return presets.find(({ isDefault }) => isDefault) ?? null;
}

export function toggleSkill(
	skills: readonly string[] | 'all',
	available: readonly string[],
	name: string,
): string[] {
	const current = skills === 'all' ? available : skills;
	return current.includes(name) ? current.filter((skill) => skill !== name) : [...current, name];
}

export function isSkillChoice(value: unknown): value is SkillChoice {
	if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
	if (value.kind === 'default' || value.kind === 'all') return true;
	if (value.kind === 'preset') {
		return 'presetId' in value && typeof value.presetId === 'string' && value.presetId.length > 0;
	}
	return value.kind === 'custom' && 'skills' in value && isSkillNameList(value.skills);
}

export function isSkillNameList(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) &&
		value.length <= SKILL_PRESET_MAX_SKILLS &&
		value.every(
			(name) =>
				typeof name === 'string' && name.trim().length > 0 && name.length <= SKILL_NAME_MAX_LENGTH,
		)
	);
}
