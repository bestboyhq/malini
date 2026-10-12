import type { RoutineJob } from '$lib/routines/domain/routine-job';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routineJobsQuery };

class RoutineJobsQuery {
	public readonly data: readonly RoutineJob[] = $derived(routinesAggregate.jobs);
}

const routineJobsQuery = new RoutineJobsQuery();
