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

export function resolveSkillChoice(
	choice: SkillChoice,
	presets: readonly SkillPresetRecord[],
): ResolvedSkills {
	if (choice.kind === 'custom') return { skills: choice.skills, preset: null };
	if (choice.kind !== 'preset') return { skills: 'all', preset: null };
	const preset = presets.find(({ id }) => id === choice.presetId);
	return preset ? { skills: preset.skills, preset } : { skills: 'all', preset: null };
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
