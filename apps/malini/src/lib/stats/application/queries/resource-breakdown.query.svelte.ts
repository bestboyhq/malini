import type { ResourceKind, ResourceKindBreakdown } from '$contract/stats';
import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';

export { resourceBreakdownQuery };

class ResourceBreakdownQuery {
	public readonly data: ReadonlyMap<ResourceKind, ResourceKindBreakdown> = $derived(
		new Map(resourcesAggregate.breakdown.map((entry) => [entry.kind, entry])),
	);
}

const resourceBreakdownQuery = new ResourceBreakdownQuery();
