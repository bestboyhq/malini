import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';

export { jobExperimentsErrorQuery };

class JobExperimentsErrorQuery {
	public readonly data: (definitionId: string) => string | null = $derived(
		(definitionId: string) => jobExperimentsAggregate.loadErrors[definitionId] ?? null,
	);
}

const jobExperimentsErrorQuery = new JobExperimentsErrorQuery();
