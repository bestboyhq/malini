import type { JobTrigger } from '$contract/routines';
import { jobTriggerOf } from '$lib/routines/domain/job-trigger';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { jobTriggersQuery };

class JobTriggersQuery {
	public readonly data: (jobId: string) => JobTrigger | null = $derived((jobId: string) =>
		jobTriggerOf(routinesAggregate.routines, jobId),
	);
}

const jobTriggersQuery = new JobTriggersQuery();
