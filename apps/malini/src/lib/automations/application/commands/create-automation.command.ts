import type { SaveAutomationDefinitionArgs } from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import {
	automationActionsStore,
	NEW_AUTOMATION_ACTION_ID,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { createAutomationCommand };

function createAutomationCommand(automation: Omit<SaveAutomationDefinitionArgs, 'id'>): void {
	void automationActionsStore.run(NEW_AUTOMATION_ACTION_ID, async () => {
		automationDefinitionsAggregate.upsert(await automationsService.saveDefinition(automation));
	});
}
