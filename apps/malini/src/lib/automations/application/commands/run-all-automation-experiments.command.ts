import { automationExperimentsAggregate } from '$lib/automations/infrastructure/aggregates/automation-experiments.aggregate.svelte';
import { runAutomationExperimentCommand } from './run-automation-experiment.command';

export { runAllAutomationExperimentsCommand };

function runAllAutomationExperimentsCommand(definitionId: string): void {
	for (const experiment of automationExperimentsAggregate.sessions[definitionId]?.experiments ??
		[]) {
		runAutomationExperimentCommand(experiment);
	}
}
