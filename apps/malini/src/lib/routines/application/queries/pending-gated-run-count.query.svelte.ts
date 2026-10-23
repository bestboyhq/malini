import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';

export { pendingGatedRunCountQuery };

class PendingGatedRunCountQuery {
	public readonly data: number = $derived(routinesAggregate.pendingGatedRuns.length);
}

const pendingGatedRunCountQuery = new PendingGatedRunCountQuery();
