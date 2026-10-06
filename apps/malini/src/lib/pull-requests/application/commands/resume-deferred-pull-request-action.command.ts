import { deferredPullRequestActionVerdict } from '$lib/pull-requests/domain/deferred-pull-request-action';
import { pullRequestAvailabilityOf } from '$lib/pull-requests/domain/pull-request-action';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { resumeDeferredPullRequestActionCommand };

function resumeDeferredPullRequestActionCommand(workstreamId: string): void {
	if (
		pullRequestScopeStore.workstreamId !== workstreamId ||
		!pullRequestScopeStore.extensionReady
	) {
		return;
	}
	const deferred = pullRequestActionStore.deferredFor(workstreamId);
	if (!deferred) return;
	const verdict = deferredPullRequestActionVerdict({
		surface: repositorySurfaceAggregate.surfaceFor(workstreamId),
		clicked: deferred.clicked,
		availability: pullRequestAvailabilityOf(pullRequestScopeStore),
	});
	if (verdict === 'wait') return;
	pullRequestActionStore.takeDeferred(workstreamId);
	if (verdict === 'run') deferred.replay();
}
