import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamByIdQuery };

class WorkstreamByIdQuery {
	public readonly data: (workstreamId: string) => Workstream | null = $derived(
		(workstreamId: string) => {
			if (!workstreamsAggregate.loaded) return null;
			return workstreamsAggregate.workstreams.find((entry) => entry.id === workstreamId) ?? null;
		},
	);
}

const workstreamByIdQuery = new WorkstreamByIdQuery();
