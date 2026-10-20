import type { ResourceSample } from '$contract/stats';
import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';

export { resourceHistoryQuery };

class ResourceHistoryQuery {
	public readonly data: readonly ResourceSample[] = $derived(resourcesAggregate.samples);
}

const resourceHistoryQuery = new ResourceHistoryQuery();
