import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { runningJobCountQuery };

class RunningJobCountQuery {
	public readonly data: number = $derived(
		jobRunsAggregate.runs.filter((run) => run.status === 'running').length,
	);
}

const runningJobCountQuery = new RunningJobCountQuery();
