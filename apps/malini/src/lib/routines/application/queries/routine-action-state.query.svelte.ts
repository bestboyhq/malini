import type { RoutineActionState } from '$lib/routines/domain/routine-action';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { routineActionStateQuery };

class RoutineActionStateQuery {
	public readonly data: (id: string) => RoutineActionState = $derived((id: string) => ({
		busy: routineActionsStore.isBusy(id),
		error: routineActionsStore.errorFor(id),
		completed: routineActionsStore.completedFor(id),
	}));
}

const routineActionStateQuery = new RoutineActionStateQuery();
