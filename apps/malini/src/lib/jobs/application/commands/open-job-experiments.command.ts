import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';

export { openJobExperimentsCommand };

function openJobExperimentsCommand(definitionId: string): void {
	void jobExperimentsAggregate.open(definitionId);
}
