import type { OwnPullRequestsState } from '$shared/repositories/domain/own-pull-requests';
import { ownPullRequestsAggregate } from '$shared/repositories/infrastructure/aggregates/own-pull-requests.aggregate.svelte';

export { ownPullRequestsQuery };

class OwnPullRequestsQuery {
	public readonly data: (repoId: string) => OwnPullRequestsState = $derived(
		(repoId: string) => ownPullRequestsAggregate.stateOf(repoId) ?? { status: 'loading' },
	);
	public readonly continuing: (head: string) => boolean = $derived((head: string) =>
		ownPullRequestsAggregate.continuing.has(head),
	);
}

const ownPullRequestsQuery = new OwnPullRequestsQuery();
