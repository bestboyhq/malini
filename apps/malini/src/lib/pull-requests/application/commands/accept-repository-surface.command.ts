import { resumeDeferredPullRequestActionCommand } from '$lib/pull-requests/application/commands/resume-deferred-pull-request-action.command';
import { settledPullRequestState } from '$lib/pull-requests/domain/pull-request-state';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';

export { acceptRepositorySurfaceCommand };

function acceptRepositorySurfaceCommand(workstreamId: string, surface: RepositorySurface): void {
	const before = repositorySurfaceAggregate.surfaceFor(workstreamId)?.pullRequest?.state;
	repositorySurfaceAggregate.accept(workstreamId, surface);
	const after = surface.pullRequest?.state;
	if (before && after && before !== after) {
		const settled = settledPullRequestState(after);
		if (settled) pullRequestStateAggregate.observe(workstreamId, settled);
		else void pullRequestStateAggregate.refreshWorkstream(workstreamId);
	}
	resumeDeferredPullRequestActionCommand(workstreamId);
}
