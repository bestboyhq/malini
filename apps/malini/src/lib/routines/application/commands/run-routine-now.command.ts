import type { Routine } from '$lib/routines/domain/routine';
import { routineRunActionId } from '$lib/routines/domain/routine-action';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { automationRulesStore } from '$shared/extensions/automation-rules.store.svelte';

export { runRoutineNowCommand };

function runRoutineNowCommand(routine: Routine, workstreamId: string): void {
	void routineActionsStore.run(routineRunActionId(routine.id), () =>
		automationRulesStore.runNow(routine, workstreamId),
	);
}
