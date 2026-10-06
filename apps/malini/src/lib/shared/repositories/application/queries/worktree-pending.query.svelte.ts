import { workstreamProvisioning } from '$shared/repositories/infrastructure/aggregates/workstream-provisioning.aggregate.svelte';

export { worktreePendingQuery };

class WorktreePendingQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		workstreamProvisioning.hasPendingWorktree(workstreamId),
	);
}

const worktreePendingQuery = new WorktreePendingQuery();
