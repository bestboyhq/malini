import type { AutomationRunRecord } from '$contract/automations';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { confirmAutomationRunCommand };

function confirmAutomationRunCommand(run: AutomationRunRecord): void {
	void automationActionsStore.run(run.id, async () => {
		automationRunsAggregate.apply(await automationsService.confirmRun(run.id));
	});
}
