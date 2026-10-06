import type { RoutineDraft } from '$lib/routines/domain/routine-draft';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import {
	ROUTINE_DRAFT_ACTION_ID,
	routineActionsStore,
} from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { createRoutineDraftCommand };

function createRoutineDraftCommand(draft: RoutineDraft): void {
	void routineActionsStore.run(ROUTINE_DRAFT_ACTION_ID, async () => {
		routinesAggregate.upsertRoutine(await routinesService.createDraft(draft));
		if (draft.suggestionId !== undefined) routinesAggregate.removeSuggestion(draft.suggestionId);
		routineActionsStore.noteDraftCreated();
		publishAutomationRulesCommand();
	});
}
