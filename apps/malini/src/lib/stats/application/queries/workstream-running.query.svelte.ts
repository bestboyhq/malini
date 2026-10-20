import type { WorkstreamRunning } from '$contract/stats';
import { workstreamRunningAggregate } from '$lib/stats/infrastructure/aggregates/workstream-running.aggregate.svelte';

export { workstreamRunningQuery };

class WorkstreamRunningQuery {
	public readonly data: (workstreamId: string) => WorkstreamRunning | null = $derived(
		(workstreamId: string) => workstreamRunningAggregate.byWorkstream.get(workstreamId) ?? null,
	);
}

const workstreamRunningQuery = new WorkstreamRunningQuery();
