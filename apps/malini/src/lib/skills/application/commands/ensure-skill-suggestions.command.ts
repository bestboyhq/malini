import { skillSuggestionsAggregate } from '$lib/skills/infrastructure/aggregates/skill-suggestions.aggregate.svelte';

export { ensureSkillSuggestionsCommand };

function ensureSkillSuggestionsCommand(): void {
	const { loadState } = skillSuggestionsAggregate;
	if (loadState === 'loading' || loadState === 'ready') return;
	void skillSuggestionsAggregate.load().catch((error: unknown) => {
		console.warn('[malini skills] Claude could not suggest presets, offering blank ones', error);
	});
}
