import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { deleteAutomationExperimentCommand };

function deleteAutomationExperimentCommand(experiment: AutomationExperimentRecord): void {
	void automationActionsStore.run(experiment.id, async () => {
		await automationsService.deleteExperiment(experiment.id);
		automationExperimentsAggregate.remove(experiment.definitionId, experiment.id);
	});
}
