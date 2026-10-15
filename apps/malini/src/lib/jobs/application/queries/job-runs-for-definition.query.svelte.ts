import type { JobRunRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { jobRunsForDefinitionQuery };

class JobRunsForDefinitionQuery {
	public readonly data: (definitionId: string) => readonly JobRunRecord[] = $derived(
		(definitionId: string) =>
			jobRunsAggregate.runs
				.filter((run) => run.definitionId === definitionId)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
	);
}

const jobRunsForDefinitionQuery = new JobRunsForDefinitionQuery();
