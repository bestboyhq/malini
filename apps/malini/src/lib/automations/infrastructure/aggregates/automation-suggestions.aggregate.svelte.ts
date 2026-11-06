import type { AutomationSuggestionRecord } from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

class AutomationSuggestionsAggregate {
	suggestions = $state.raw<readonly AutomationSuggestionRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const suggestions = await automationsService.listSuggestions();
		if (generation !== this.#generation) return;
		this.suggestions = suggestions;
	}

	apply(suggestion: AutomationSuggestionRecord): void {
		const others = this.suggestions.filter((existing) => existing.id !== suggestion.id);
		this.suggestions = suggestion.status === 'dismissed' ? others : [suggestion, ...others];
	}

	reset(): void {
		this.#generation += 1;
		this.suggestions = [];
	}
}

export const automationSuggestionsAggregate = new AutomationSuggestionsAggregate();
