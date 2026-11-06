import type { ReconcilerDecisionRecord } from '$contract/automations';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';
import { automationActionsStore } from '$lib/automations/infrastructure/stores/automation-actions.store.svelte';

export { decideCommand };

function decideCommand(decision: ReconcilerDecisionRecord, candidate: number): void {
	void automationActionsStore.run(decision.id, async () => {
		reconcilerDecisionsAggregate.apply(await automationsService.decide(decision.id, candidate));
	});
}
