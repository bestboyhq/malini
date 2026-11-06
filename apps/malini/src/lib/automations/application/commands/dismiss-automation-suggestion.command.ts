import { automationSuggestionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-suggestions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { dismissAutomationSuggestionCommand };

function dismissAutomationSuggestionCommand(suggestionId: string): void {
	void automationActionsStore.run(suggestionId, async () => {
		automationSuggestionsAggregate.apply(await automationsService.dismissSuggestion(suggestionId));
	});
}
