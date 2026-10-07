import { resumeDeferredPullRequestActionCommand } from '$lib/pull-requests/application/commands/resume-deferred-pull-request-action.command';
import { observedPullRequestState } from '$lib/pull-requests/domain/pull-request-state';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';

export { acceptRepositorySurfaceCommand };

function acceptRepositorySurfaceCommand(workstreamId: string, surface: RepositorySurface): void {
	repositorySurfaceAggregate.accept(workstreamId, surface);
	const observed = surface.workstreamId === workstreamId ? observedPullRequestState(surface) : null;
	if (observed) pullRequestStateAggregate.observe(workstreamId, observed);
	resumeDeferredPullRequestActionCommand(workstreamId);
}
