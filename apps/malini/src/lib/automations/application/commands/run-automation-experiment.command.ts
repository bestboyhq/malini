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
		let saved = experiment;
		if (instructions !== undefined && instructions.trim() !== experiment.instructions) {
			saved = await automationsService.saveExperiment({
				definitionId: experiment.definitionId,
				experimentId: experiment.id,
				provider: experiment.provider,
				model: experiment.model,
				instructions,
			});
			automationExperimentsAggregate.apply(saved);
		}
		automationExperimentsAggregate.apply({ ...saved, running: true, results: [] });
		try {
			await automationsService.runExperiment(saved.id);
		} catch (error) {
			automationExperimentsAggregate.apply(saved);
			throw error;
		}
	});
}
