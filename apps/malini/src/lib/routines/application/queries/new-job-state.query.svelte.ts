import type { RoutineActionState } from '$lib/routines/domain/routine-action';
import { ROUTINE_NEW_JOB_ACTION_ID } from '$lib/routines/domain/routine-action';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { newJobStateQuery };

class NewJobStateQuery {
	public readonly data: RoutineActionState = $derived({
		busy: routineActionsStore.isBusy(ROUTINE_NEW_JOB_ACTION_ID),
		error: routineActionsStore.errorFor(ROUTINE_NEW_JOB_ACTION_ID),
		completed: routineActionsStore.completedFor(ROUTINE_NEW_JOB_ACTION_ID),
	});
}

const newJobStateQuery = new NewJobStateQuery();
