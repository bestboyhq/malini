import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routineGateService } from '$lib/routines/infrastructure/services/routine-gate.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { rejectGatedRunCommand };

function rejectGatedRunCommand(gatedRunId: string): void {
	void routineActionsStore.run(gatedRunId, async () => {
		routinesAggregate.applyGatedRun(await routineGateService.reject(gatedRunId));
	});
}
