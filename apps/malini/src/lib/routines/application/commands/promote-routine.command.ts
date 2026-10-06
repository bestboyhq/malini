import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { promoteRoutineCommand };

function promoteRoutineCommand(routineId: string): void {
	void routineActionsStore.run(routineId, async () => {
		routinesAggregate.upsertRoutine(await routinesService.promote(routineId));
		publishAutomationRulesCommand();
	});
}
