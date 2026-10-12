import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';

export { jobsLoadQuery };

class JobsLoadQuery {
	public readonly data: Readonly<{
		state: 'idle' | 'loading' | 'ready' | 'error';
		error: string | null;
	}> = $derived({
		state: jobDefinitionsAggregate.loadState,
		error: jobDefinitionsAggregate.loadError,
	});
}

const jobsLoadQuery = new JobsLoadQuery();
