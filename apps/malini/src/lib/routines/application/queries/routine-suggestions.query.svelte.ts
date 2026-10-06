import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routineSuggestionsQuery };

class RoutineSuggestionsQuery {
	public readonly data: readonly RoutineSuggestion[] = $derived(routinesAggregate.suggestions);
}

const routineSuggestionsQuery = new RoutineSuggestionsQuery();
