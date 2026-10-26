import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { waitingForYouJobCountQuery };

class WaitingForYouJobCountQuery {
	public readonly data: number = $derived(
		jobRunsAggregate.runs.filter((run) => run.status === 'waiting' || run.status === 'needs-you')
			.length +
			reconcilerDecisionsAggregate.decisions.filter((decision) => decision.status === 'asking')
				.length,
	);
}

const waitingForYouJobCountQuery = new WaitingForYouJobCountQuery();
