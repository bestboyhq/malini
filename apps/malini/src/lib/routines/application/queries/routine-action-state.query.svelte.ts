import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { routineActionStateQuery };

class RoutineActionStateQuery {
	public readonly data: (id: string) => Readonly<{ busy: boolean; error: string | null }> =
		$derived((id: string) => ({
			busy: routineActionsStore.isBusy(id),
			error: routineActionsStore.errorFor(id),
		}));
}

const routineActionStateQuery = new RoutineActionStateQuery();
