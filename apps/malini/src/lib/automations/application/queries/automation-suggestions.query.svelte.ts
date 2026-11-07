import type { AutomationSuggestionRecord } from '$contract/automations';
import { automationSuggestionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-suggestions.aggregate.svelte';

export { automationSuggestionsQuery };

class AutomationSuggestionsQuery {
	public readonly data: readonly AutomationSuggestionRecord[] = $derived(
		automationSuggestionsAggregate.suggestions
			.filter((suggestion) => suggestion.status === 'open')
			.sort(
				(left, right) =>
					right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
			),
	);

	afterRun(runId: string): AutomationSuggestionRecord | null {
		return (
			automationSuggestionsAggregate.suggestions.find(
				(suggestion) => suggestion.afterRunId === runId,
			) ?? null
		);
	}
}

const automationSuggestionsQuery = new AutomationSuggestionsQuery();
