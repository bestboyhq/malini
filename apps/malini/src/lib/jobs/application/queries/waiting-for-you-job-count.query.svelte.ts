import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { waitingForYouJobCountQuery };

class WaitingForYouJobCountQuery {
	public readonly data: number = $derived(
		jobRunsAggregate.runs.filter((run) => run.status === 'waiting' || run.status === 'needs-you')
			.length,
	);
}

const waitingForYouJobCountQuery = new WaitingForYouJobCountQuery();
