import { ROUTINE_DRAFT_ACTION_ID } from '$lib/routines/domain/routine-action';
import type { RoutineDraft } from '$lib/routines/domain/routine-draft';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { routineFormStore } from '$lib/routines/infrastructure/stores/routine-form.store.svelte';
import { publishAutomationRulesCommand } from './publish-automation-rules.command';

export { createRoutineDraftCommand };

function createRoutineDraftCommand(draft: RoutineDraft): void {
	void routineActionsStore.run(ROUTINE_DRAFT_ACTION_ID, async () => {
		routinesAggregate.upsertRoutine(await routinesService.createDraft(draft));
		if (draft.suggestionId !== undefined) routinesAggregate.removeSuggestion(draft.suggestionId);
		routineFormStore.seed = null;
		publishAutomationRulesCommand();
	});
}
