import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { awaitPullRequestActionScope } from '$lib/pull-requests/domain/pull-request-action-scope';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	pullRequestActionFailureDetail,
} from '$lib/pull-requests/domain/pull-request-action';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { refreshRepositorySurfaceCommand };

function refreshRepositorySurfaceCommand(): void {
	if (pullRequestActionStore.busy) return;
	const scope = pullRequestScopeStore.claim('Refreshing…');
	if (!scope) return;

	void (async () => {
		try {
			const outcome = await awaitPullRequestActionScope(
				scope,
				repositoryExtensionService.execute(
					scope.workstreamId,
					REPOSITORY_EXTENSION_COMMANDS.refresh,
				),
				() => pullRequestScopeStore.snapshot(),
			);
			if (!outcome || !pullRequestScopeStore.isCurrent(scope)) return;
			repositorySurfaceAggregate.accept(scope.workstreamId, outcome.surface);
		} catch (error) {
			if (!pullRequestScopeStore.isCurrent(scope)) return;
			toast.error(
				`Repository refresh failed · ${pullRequestActionFailureDetail(error, 'The repository status could not be refreshed')}`,
				aboutWorkstream(scope.workstreamId),
			);
		} finally {
			pullRequestActionStore.release(scope.actionRevision);
		}
	})();
}
