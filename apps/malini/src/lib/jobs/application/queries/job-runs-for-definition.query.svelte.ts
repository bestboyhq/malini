import type { JobRunRecord } from '$contract/jobs';
import { jobRunLastActivityAt } from '$lib/jobs/domain/job-run';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { jobRunsForDefinitionQuery };

class JobRunsForDefinitionQuery {
	public readonly data: (definitionId: string) => readonly JobRunRecord[] = $derived(
		(definitionId: string) =>
			jobRunsAggregate.runs
				.filter((run) => run.definitionId === definitionId)
				.sort((left, right) =>
					jobRunLastActivityAt(right).localeCompare(jobRunLastActivityAt(left)),
				),
	);
}

const jobRunsForDefinitionQuery = new JobRunsForDefinitionQuery();
