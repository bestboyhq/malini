import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';
import { automationExperimentsActionId } from '$lib/automations/infrastructure/stores/automation-experiment-selection.store.svelte';

export { newAutomationExperimentStateQuery };

class NewAutomationExperimentStateQuery {
	public readonly data: (
		definitionId: string,
	) => Readonly<{ busy: boolean; error: string | null }> = $derived((definitionId: string) => ({
		busy: automationActionsStore.isBusy(automationExperimentsActionId(definitionId)),
		error: automationActionsStore.errorFor(automationExperimentsActionId(definitionId)),
	}));
}

const newAutomationExperimentStateQuery = new NewAutomationExperimentStateQuery();
