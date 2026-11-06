import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentSelectionStore } from '$lib/automations/infrastructure/stores/automation-experiment-selection.store.svelte';

export { selectAutomationExperimentCommand };

function selectAutomationExperimentCommand(experiment: AutomationExperimentRecord): void {
	automationExperimentSelectionStore.select(experiment.definitionId, experiment.id);
}
