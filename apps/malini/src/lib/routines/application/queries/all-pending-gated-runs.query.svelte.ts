import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { allPendingGatedRunsQuery };

class AllPendingGatedRunsQuery {
	public readonly data: readonly RoutineGatedRun[] = $derived(routinesAggregate.pendingGatedRuns);
}

const allPendingGatedRunsQuery = new AllPendingGatedRunsQuery();
