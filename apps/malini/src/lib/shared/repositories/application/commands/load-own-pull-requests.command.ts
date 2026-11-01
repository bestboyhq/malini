import { ownPullRequestsAggregate } from '$shared/repositories/infrastructure/aggregates/own-pull-requests.aggregate.svelte';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';

export { loadOwnPullRequestsCommand };

function loadOwnPullRequestsCommand(repoId: string): void {
	if (ownPullRequestsAggregate.stateOf(repoId) === null) {
		ownPullRequestsAggregate.set(repoId, { status: 'loading' });
	}
	void (async () => {
		try {
			const pullRequests = await workstreamsService.listOwnPullRequests(repoId);
			ownPullRequestsAggregate.set(repoId, { status: 'ready', pullRequests });
		} catch (error) {
			ownPullRequestsAggregate.set(repoId, {
				status: 'failed',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	})();
}
