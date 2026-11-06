import type { SaveAutomationDefinitionArgs } from '$contract/automations';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import {
	AUTOMATION_FORM_ACTION_ID,
	automationActionsStore,
} from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { saveAutomationDefinitionCommand };

function saveAutomationDefinitionCommand(args: SaveAutomationDefinitionArgs): void {
	void automationActionsStore.run(AUTOMATION_FORM_ACTION_ID, async () => {
		automationDefinitionsAggregate.upsert(await automationsService.saveDefinition(args));
	});
}
