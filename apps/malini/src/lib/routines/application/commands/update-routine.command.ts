import { routineUpdateActionId } from '$lib/routines/domain/routine-action';
import type { RoutineUpdate } from '$lib/routines/domain/routine-draft';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { updateRoutineCommand };

function updateRoutineCommand(routineId: string, update: RoutineUpdate): void {
	void routineActionsStore.run(routineUpdateActionId(routineId), async () => {
		routinesAggregate.upsertRoutine(await routinesService.update(routineId, update));
		publishAutomationRulesCommand();
	});
}
