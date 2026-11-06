import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { runAutomationExperimentCommand };

function runAutomationExperimentCommand(
	experiment: AutomationExperimentRecord,
	instructions?: string,
): void {
	if (experiment.running) return;
	void automationActionsStore.run(experiment.id, async () => {
		if (instructions !== undefined && instructions.trim() !== experiment.instructions) {
			automationExperimentsAggregate.apply(
				await automationsService.saveExperiment({
					definitionId: experiment.definitionId,
					experimentId: experiment.id,
					provider: experiment.provider,
					model: experiment.model,
					instructions,
				}),
			);
		}
		automationExperimentsAggregate.apply(await automationsService.runExperiment(experiment.id));
	});
}
