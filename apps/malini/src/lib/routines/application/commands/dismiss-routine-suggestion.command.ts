import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routinesService } from '$lib/routines/infrastructure/services/routines.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { dismissRoutineSuggestionCommand };

function dismissRoutineSuggestionCommand(suggestionId: string): void {
	void routineActionsStore.run(suggestionId, async () => {
		routinesAggregate.applySuggestion(await routinesService.dismissSuggestion(suggestionId));
	});
}
