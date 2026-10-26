import type { ReconcilerDecisionRecord } from '$contract/jobs';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { reconcilerDecisionsQuery };

class ReconcilerDecisionsQuery {
	public readonly data: readonly ReconcilerDecisionRecord[] = $derived(
		reconcilerDecisionsAggregate.decisions,
	);
}

const reconcilerDecisionsQuery = new ReconcilerDecisionsQuery();
