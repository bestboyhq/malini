import { workstreamRunningAggregate } from '$lib/stats/infrastructure/aggregates/workstream-running.aggregate.svelte';

export { stoppingRunningItemsQuery };

const NONE: ReadonlySet<string> = new Set();

class StoppingRunningItemsQuery {
	public readonly data: (workstreamId: string) => ReadonlySet<string> = $derived(
		(workstreamId: string) => workstreamRunningAggregate.stopping.get(workstreamId) ?? NONE,
	);
}

const stoppingRunningItemsQuery = new StoppingRunningItemsQuery();
