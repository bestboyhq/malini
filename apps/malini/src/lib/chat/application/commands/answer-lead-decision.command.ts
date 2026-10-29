import { leadDecisionsAggregate } from '$lib/chat/infrastructure/aggregates/lead-decisions.aggregate.svelte';
import { leadDecisionsService } from '$lib/chat/infrastructure/services/lead-decisions.service';
import { leadDecisionFocusStore } from '$lib/chat/infrastructure/stores/lead-decision-focus.store.svelte';
import { captureRendererError } from '$shared/errors/renderer-error-sink';

export function answerLeadDecisionCommand(
	decisionId: string,
	option: number,
	reason: string,
): void {
	leadDecisionFocusStore.viewing = null;
	if (leadDecisionFocusStore.focusedId === decisionId) leadDecisionFocusStore.focusedId = null;
	void (async () => {
		try {
			const why = reason.trim();
			leadDecisionsAggregate.apply(
				await leadDecisionsService.answer({ decisionId, option, ...(why ? { reason: why } : {}) }),
			);
		} catch (error) {
			captureRendererError('caught', error);
		}
	})();
}
