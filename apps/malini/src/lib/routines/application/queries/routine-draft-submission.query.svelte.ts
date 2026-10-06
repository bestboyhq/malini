import {
	ROUTINE_DRAFT_ACTION_ID,
	routineActionsStore,
} from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { routineDraftSubmissionQuery };

class RoutineDraftSubmissionQuery {
	public readonly data: Readonly<{ busy: boolean; error: string | null; created: number }> =
		$derived({
			busy: routineActionsStore.isBusy(ROUTINE_DRAFT_ACTION_ID),
			error: routineActionsStore.errorFor(ROUTINE_DRAFT_ACTION_ID),
			created: routineActionsStore.draftsCreated,
		});
}

const routineDraftSubmissionQuery = new RoutineDraftSubmissionQuery();
