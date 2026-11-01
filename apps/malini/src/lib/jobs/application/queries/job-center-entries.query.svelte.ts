import { jobCenterEntries, type JobCenterEntry } from '$lib/jobs/domain/job-center';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { jobCenterEntriesQuery };

class JobCenterEntriesQuery {
	public readonly data: readonly JobCenterEntry[] = $derived(
		jobCenterEntries(jobRunsAggregate.runs, reconcilerDecisionsAggregate.decisions),
	);
}

const jobCenterEntriesQuery = new JobCenterEntriesQuery();
