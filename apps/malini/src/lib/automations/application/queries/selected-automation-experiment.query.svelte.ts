import type { AutomationExperimentRecord } from '$contract/automations';
import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { automationExperimentSelectionStore } from '$lib/automations/infrastructure/stores/automation-experiment-selection.store.svelte';

export { selectedAutomationExperimentQuery };

class SelectedAutomationExperimentQuery {
	public readonly data: (definitionId: string) => AutomationExperimentRecord | null = $derived(
		(definitionId: string) => {
			const experiments = automationExperimentsAggregate.sessions[definitionId]?.experiments ?? [];
			const selected = automationExperimentSelectionStore.selected[definitionId];
			return (
				experiments.find((experiment) => experiment.id === selected) ?? experiments.at(-1) ?? null
			);
		},
	);
}

const selectedAutomationExperimentQuery = new SelectedAutomationExperimentQuery();
