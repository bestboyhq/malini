import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';
import { runJobExperimentCommand } from './run-job-experiment.command';

export { runAllJobExperimentsCommand };

function runAllJobExperimentsCommand(definitionId: string): void {
	for (const experiment of jobExperimentsAggregate.sessions[definitionId]?.experiments ?? []) {
		runJobExperimentCommand(experiment);
	}
}
