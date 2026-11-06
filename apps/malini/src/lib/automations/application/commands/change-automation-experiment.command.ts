import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { changeAutomationExperimentCommand };

function changeAutomationExperimentCommand(
	experiment: AutomationExperimentRecord,
	change: Readonly<{ provider?: string; model?: string; instructions?: string }>,
): void {
	const provider = change.provider ?? experiment.provider;
	const model = change.model ?? experiment.model;
	const instructions = change.instructions ?? experiment.instructions;
	if (
		provider === experiment.provider &&
		model === experiment.model &&
		instructions === experiment.instructions
	) {
		return;
	}
	void automationActionsStore.run(experiment.id, async () => {
		automationExperimentsAggregate.apply(
			await automationsService.saveExperiment({
				definitionId: experiment.definitionId,
				experimentId: experiment.id,
				provider,
				model,
				instructions,
			}),
		);
	});
}
