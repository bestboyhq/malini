import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routineSuggestionCountQuery };

class RoutineSuggestionCountQuery {
	public readonly data: number = $derived(routinesAggregate.suggestions.length);
}

const routineSuggestionCountQuery = new RoutineSuggestionCountQuery();
