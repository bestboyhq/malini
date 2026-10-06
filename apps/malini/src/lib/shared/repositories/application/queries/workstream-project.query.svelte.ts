import type { Project } from '$shared/repositories/domain/repository';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamProjectQuery };

class WorkstreamProjectQuery {
	public readonly data: (workstreamId: string) => Project | null = $derived(
		(workstreamId: string) => {
			if (!workstreamsAggregate.loaded) return null;
			const workstream = workstreamsAggregate.workstreams.find(
				(entry) => entry.id === workstreamId,
			);
			if (!workstream) return null;
			return (
				workstreamsAggregate.projects.find((entry) => entry.id === workstream.projectId) ?? null
			);
		},
	);
}

const workstreamProjectQuery = new WorkstreamProjectQuery();
