import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamsLoadedQuery };

class WorkstreamsLoadedQuery {
	public readonly data: boolean = $derived(workstreamsAggregate.loaded);
}

const workstreamsLoadedQuery = new WorkstreamsLoadedQuery();
