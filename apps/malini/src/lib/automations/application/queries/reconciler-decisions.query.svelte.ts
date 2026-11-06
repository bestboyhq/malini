import type { ReconcilerDecisionRecord } from '$contract/automations';
import { reconcilerDecisionsAggregate } from '$lib/automations/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { reconcilerDecisionsQuery };

class ReconcilerDecisionsQuery {
	public readonly data: readonly ReconcilerDecisionRecord[] = $derived(
		reconcilerDecisionsAggregate.decisions,
	);
}

const reconcilerDecisionsQuery = new ReconcilerDecisionsQuery();
