import type { RunAutomationArgs } from '$contract/automations';
import { automationRunsAggregate } from '$lib/automations/infrastructure/aggregates/automation-runs.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { runAutomationCommand };

function runAutomationCommand(args: RunAutomationArgs): void {
	void automationActionsStore.run(args.definitionId, async () => {
		automationRunsAggregate.apply(await automationsService.run({ ...args, origin: 'manual' }));
	});
}
