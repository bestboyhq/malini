import { observedPullRequestState } from '$lib/pull-requests/domain/pull-request-state';
import {
	repositorySurfaceHasBeenRead,
	surfaceMergedHead,
	type RepositorySurface,
} from '$lib/pull-requests/domain/repository-surface';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { noteMergedHeadCommand } from '$shared/repositories/repositories.api';

export { acceptRepositorySurfaceCommand };

function acceptRepositorySurfaceCommand(workstreamId: string, surface: RepositorySurface): void {
	repositorySurfaceAggregate.accept(workstreamId, surface);
	if (surface.workstreamId !== workstreamId) return;
	const observed = observedPullRequestState(surface);
	if (observed) pullRequestStateAggregate.observe(workstreamId, observed);
	if (repositorySurfaceHasBeenRead(surface)) {
		noteMergedHeadCommand(workstreamId, surfaceMergedHead(surface));
	}
}
