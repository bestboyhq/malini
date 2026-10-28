import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { noteMergedHeadCommand } from '$shared/repositories/repositories.api';

export { forgetWorkstreamSurfaceCommand };

function forgetWorkstreamSurfaceCommand(workstreamId: string): void {
	if (!workstreamId) return;
	repositorySurfaceAggregate.forget(workstreamId);
	noteMergedHeadCommand(workstreamId, null);
}
