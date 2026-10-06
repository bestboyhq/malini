import type { PullRequestActivity } from '$shared/repositories/repositories.api';
import { pullRequestRefreshActivity } from '$lib/pull-requests/domain/repository-surface';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';

export { pullRequestRefreshActivityQuery };

class PullRequestRefreshActivityQuery {
	public readonly data: (workstreamId: string) => PullRequestActivity = $derived(
		(workstreamId: string) =>
			pullRequestRefreshActivity(repositorySurfaceAggregate.presentedSurfaceFor(workstreamId)),
	);
}

const pullRequestRefreshActivityQuery = new PullRequestRefreshActivityQuery();
