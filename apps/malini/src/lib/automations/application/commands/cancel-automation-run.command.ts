import type { AutomationRunRecord } from '$contract/automations';
import { toast } from '$hyper-ui/components/toast';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { cancelAutomationRunCommand };

function cancelAutomationRunCommand(run: AutomationRunRecord): void {
	void automationActionsStore.run(run.id, async () => {
		try {
			automationRunsAggregate.apply(await automationsService.cancelRun(run.id));
		} catch (error) {
			toast.error(
				`Could not cancel ${run.title} · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}
