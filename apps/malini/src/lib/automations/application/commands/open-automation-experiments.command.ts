import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';

export { openAutomationExperimentsCommand };

function openAutomationExperimentsCommand(definitionId: string): void {
	void automationExperimentsAggregate.open(definitionId);
}
