import { pullRequestAvailabilityOf } from '$lib/pull-requests/domain/pull-request-action';
import {
	surfaceGithubStatus,
	type GithubStatus,
} from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { pullRequestGithubStatusQuery };

class PullRequestGithubStatusQuery {
	public readonly data: GithubStatus | null = $derived(
		surfaceGithubStatus(
			repositorySurfaceAggregate.presentedSurfaceFor(pullRequestScopeStore.workstreamId),
			pullRequestAvailabilityOf(pullRequestScopeStore),
		),
	);
}

const pullRequestGithubStatusQuery = new PullRequestGithubStatusQuery();
