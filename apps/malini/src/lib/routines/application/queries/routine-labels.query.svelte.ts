import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { routineLabelsQuery };

class RoutineLabelsQuery {
	public readonly data: (routineId: string) => string | null = $derived(
		(routineId: string) =>
			routinesAggregate.routines.find((routine) => routine.id === routineId)?.label ?? null,
	);
}

const routineLabelsQuery = new RoutineLabelsQuery();
