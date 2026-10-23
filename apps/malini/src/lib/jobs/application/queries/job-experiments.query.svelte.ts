import type { JobExperimentsRecord } from '$contract/jobs';
import { jobExperimentsAggregate } from '$lib/jobs/infrastructure/aggregates/job-experiments.aggregate.svelte';

export { jobExperimentsQuery };

class JobExperimentsQuery {
	public readonly data: (definitionId: string) => JobExperimentsRecord | null = $derived(
		(definitionId: string) => jobExperimentsAggregate.sessions[definitionId] ?? null,
	);
}

const jobExperimentsQuery = new JobExperimentsQuery();
