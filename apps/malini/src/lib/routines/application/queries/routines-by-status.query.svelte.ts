import type { Routine, RoutineStatus } from '$lib/routines/domain/routine';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routinesByStatusQuery };

class RoutinesByStatusQuery {
	public readonly data: (status: RoutineStatus) => readonly Routine[] = $derived(
		(status: RoutineStatus) => routinesAggregate.routinesWithStatus(status),
	);
}

const routinesByStatusQuery = new RoutinesByStatusQuery();
