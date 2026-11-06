import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';
import {
	automationExperimentSelectionStore,
	automationExperimentsActionId,
} from '$lib/automations/infrastructure/stores/automation-experiment-selection.store.svelte';

export { addAutomationExperimentCommand };

function addAutomationExperimentCommand(from: AutomationExperimentRecord): void {
	void automationActionsStore.run(automationExperimentsActionId(from.definitionId), async () => {
		const experiment = await automationsService.saveExperiment({
			definitionId: from.definitionId,
			provider: from.provider,
			model: from.model,
			instructions: from.instructions,
		});
		automationExperimentsAggregate.apply(experiment);
		automationExperimentSelectionStore.select(experiment.definitionId, experiment.id);
	});
}
