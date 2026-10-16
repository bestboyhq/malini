import type { SkillPresetRecord, SkillPresetSuggestion } from '$contract/skills';

export type SkillSuggestions = Readonly<{
	suggesting: boolean;
	offered: readonly SkillPresetSuggestion[];
}>;

const BLANK_SUGGESTIONS: readonly SkillPresetSuggestion[] = [
	{ name: 'Builder', emoji: '🛠️', skills: [] },
	{ name: 'Marketer', emoji: '📣', skills: [] },
];

export function offeredSuggestions(
	loadState: 'idle' | 'loading' | 'ready' | 'error',
	suggested: readonly SkillPresetSuggestion[],
	presets: readonly SkillPresetRecord[],
): SkillSuggestions {
	if (loadState === 'idle' || loadState === 'loading') return { suggesting: true, offered: [] };
	const taken = new Set(presets.map(({ name }) => name.toLocaleLowerCase()));
	const pool = suggested.length > 0 ? suggested : BLANK_SUGGESTIONS;
	return {
		suggesting: false,
		offered: pool.filter(({ name }) => !taken.has(name.toLocaleLowerCase())),
	};
}
