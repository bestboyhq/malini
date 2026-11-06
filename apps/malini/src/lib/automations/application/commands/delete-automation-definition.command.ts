import { goto } from '$shared/router/navigation';
import { AUTOMATIONS_HREF, automationHref } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import { automationDefinitionsAggregate } from '$lib/automations/infrastructure/aggregates/automation-definitions.aggregate.svelte';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { deleteAutomationDefinitionCommand };

function deleteAutomationDefinitionCommand(definitionId: string): void {
	void automationActionsStore.run(definitionId, async () => {
		await automationsService.deleteDefinition(definitionId);
		automationDefinitionsAggregate.remove(definitionId);
		automationRunsAggregate.forgetDefinition(definitionId);
		if (page.url.pathname === automationHref(definitionId)) {
			await goto(AUTOMATIONS_HREF, { replaceState: true });
		}
	});
}
