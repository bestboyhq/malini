import type {
	AutomationSuggestionRecord,
	SaveAutomationDefinitionArgs,
} from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationSuggestionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-suggestions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { acceptAutomationSuggestionCommand };

function acceptAutomationSuggestionCommand(
	suggestion: AutomationSuggestionRecord,
	automation?: Omit<SaveAutomationDefinitionArgs, 'id'>,
): void {
	void automationActionsStore.run(suggestion.id, async () => {
		const accepted = await automationsService.acceptSuggestion(suggestion.id, automation);
		automationDefinitionsAggregate.upsert(accepted.automation);
		automationSuggestionsAggregate.apply(accepted.suggestion);
	});
}
