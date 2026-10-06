import type { WorkstreamDiff } from '$shared/repositories/domain/workstream-diff';
import { workstreamDiffAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-diff.aggregate.svelte';

export { workstreamDiffQuery };

class WorkstreamDiffQuery {
	public readonly data: (workstreamId: string, path: string | null) => WorkstreamDiff | null =
		$derived((workstreamId: string, path: string | null) =>
			workstreamDiffAggregate.diffFor(workstreamId, path),
		);
}

const workstreamDiffQuery = new WorkstreamDiffQuery();
