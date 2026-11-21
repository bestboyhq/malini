import type { SessionStatus } from '$contract/agent-state-machine';
import {
	pullRequestAvailabilityOf,
	type PullRequestTopBar,
} from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestTopBar } from '$lib/pull-requests/domain/pull-request-top-bar';
import type { RepositorySurface } from '$lib/pull-requests/domain/repository-surface';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';
import { checkoutHealthQuery, connectionProblemQuery } from '$shared/repositories/repositories.api';

export { pullRequestTopBarQuery };

class PullRequestTopBarQuery {
	public readonly data: (agentStatus: SessionStatus | null) => PullRequestTopBar = $derived(
		(agentStatus: SessionStatus | null) =>
			pullRequestTopBar(
				pullRequestShipAggregate.shipFor(pullRequestScopeStore.workstreamId),
				surfaceWithoutDiagnosedCheckout(pullRequestScopeStore.workstreamId),
				pullRequestAvailabilityOf(pullRequestScopeStore),
				agentStatus,
				pullRequestStateAggregate.readHeadFor(pullRequestScopeStore.workstreamId),
				connectionProblemQuery.data === null,
			),
	);
}

const pullRequestTopBarQuery = new PullRequestTopBarQuery();

function surfaceWithoutDiagnosedCheckout(workstreamId: string): RepositorySurface | null {
	const surface = repositorySurfaceAggregate.presentedSurfaceFor(workstreamId);
	if (surface === null || checkoutHealthQuery.data(workstreamId).state === 'healthy')
		return surface;
	return { ...surface, localError: null };
}
