import { offeredSuggestions, type SkillSuggestions } from '$lib/skills/domain/skill-suggestions';
import { skillPresetsAggregate } from '$lib/skills/infrastructure/aggregates/skill-presets.aggregate.svelte';
import { skillSuggestionsAggregate } from '$lib/skills/infrastructure/aggregates/skill-suggestions.aggregate.svelte';

export { skillSuggestionsQuery };

class SkillSuggestionsQuery {
	public readonly data: SkillSuggestions = $derived(
		offeredSuggestions(
			skillSuggestionsAggregate.loadState,
			skillSuggestionsAggregate.presets,
			skillPresetsAggregate.presets,
		),
	);
}

const skillSuggestionsQuery = new SkillSuggestionsQuery();
