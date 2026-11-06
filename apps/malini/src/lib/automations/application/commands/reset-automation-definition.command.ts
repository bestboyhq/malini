import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { resetAutomationDefinitionCommand };

function resetAutomationDefinitionCommand(definitionId: string): void {
	void automationActionsStore.run(definitionId, async () => {
		automationDefinitionsAggregate.upsert(await automationsService.resetDefinition(definitionId));
	});
}
