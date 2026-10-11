import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { needsYouJobCountQuery };

class NeedsYouJobCountQuery {
	public readonly data: number = $derived(
		jobRunsAggregate.runs.filter((run) => run.status === 'needs-you').length,
	);
}

const needsYouJobCountQuery = new NeedsYouJobCountQuery();
