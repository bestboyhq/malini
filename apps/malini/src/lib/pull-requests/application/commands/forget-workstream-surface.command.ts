import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';

export { forgetWorkstreamSurfaceCommand };

function forgetWorkstreamSurfaceCommand(workstreamId: string): void {
	if (!workstreamId) return;
	repositorySurfaceAggregate.forget(workstreamId);
}
