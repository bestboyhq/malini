import type { ResourceSample } from '$contract/stats';
import { resourcesAggregate } from '$lib/stats/infrastructure/aggregates/resources.aggregate.svelte';

export { latestResourceSampleQuery };

class LatestResourceSampleQuery {
	public readonly data: ResourceSample | null = $derived(resourcesAggregate.samples.at(-1) ?? null);
}

const latestResourceSampleQuery = new LatestResourceSampleQuery();
