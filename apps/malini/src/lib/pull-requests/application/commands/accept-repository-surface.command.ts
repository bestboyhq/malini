import { resumeDeferredPullRequestActionCommand } from '$lib/pull-requests/application/commands/resume-deferred-pull-request-action.command';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';

export { acceptRepositorySurfaceCommand };

function acceptRepositorySurfaceCommand(workstreamId: string, surface: RepositorySurface): void {
	repositorySurfaceAggregate.accept(workstreamId, surface);
	resumeDeferredPullRequestActionCommand(workstreamId);
}
