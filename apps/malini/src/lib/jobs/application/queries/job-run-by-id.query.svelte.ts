import type { JobRunRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { jobRunByIdQuery };

class JobRunByIdQuery {
	public readonly data: (jobRunId: string | null) => JobRunRecord | null = $derived(
		(jobRunId: string | null) => jobRunsAggregate.runs.find((run) => run.id === jobRunId) ?? null,
	);
}

const jobRunByIdQuery = new JobRunByIdQuery();
