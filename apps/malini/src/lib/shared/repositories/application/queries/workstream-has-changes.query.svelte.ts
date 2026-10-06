import { workstreamHasChanges } from '$shared/repositories/domain/workstream-git-status';
import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';

export { workstreamHasChangesQuery };

class WorkstreamHasChangesQuery {
	public readonly data: boolean = $derived(
		workstreamHasChanges(workstreamGitStatusAggregate.status),
	);
}

const workstreamHasChangesQuery = new WorkstreamHasChangesQuery();
