import type { RoutineGatedRun } from '$lib/routines/domain/routine-gated-run';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { pendingGatedRunsQuery };

class PendingGatedRunsQuery {
	public readonly data: (routineId: string) => readonly RoutineGatedRun[] = $derived(
		(routineId: string) => routinesAggregate.gatedRunsFor(routineId),
	);
}

const pendingGatedRunsQuery = new PendingGatedRunsQuery();
