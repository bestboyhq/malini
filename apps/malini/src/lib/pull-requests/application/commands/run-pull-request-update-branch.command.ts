import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	pullRequestActionFailureDetail,
	pullRequestActionOutcome,
	pullRequestActionRefreshesGitStatus,
} from '$lib/pull-requests/domain/pull-request-action';
import { awaitPullRequestActionScope } from '$lib/pull-requests/domain/pull-request-action-scope';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestUpdateBranchCommand };

function runPullRequestUpdateBranchCommand(onGitStatusStale: () => void): void {
	if (pullRequestActionStore.busy) return;
	const scope = pullRequestScopeStore.claim('Updating branch…');
	if (!scope) return;
	void (async () => {
		try {
			const outcome = await awaitPullRequestActionScope(
				scope,
				repositoryExtensionService.execute(
					scope.workstreamId,
					REPOSITORY_EXTENSION_COMMANDS.pullLatest,
				),
				() => pullRequestScopeStore.snapshot(),
			);
			if (!outcome || !pullRequestScopeStore.isCurrent(scope)) return;
			repositorySurfaceAggregate.accept(scope.workstreamId, outcome.surface);
			const announced = pullRequestActionOutcome('update', outcome.surface);
			if (announced) toast[announced.level](announced.message, aboutWorkstream(scope.workstreamId));
			if (pullRequestActionRefreshesGitStatus('update')) onGitStatusStale();
		} catch (error) {
			if (!pullRequestScopeStore.isCurrent(scope)) return;
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, 'The branch could not be updated')}`,
				aboutWorkstream(scope.workstreamId),
			);
		} finally {
			pullRequestActionStore.release(scope.actionRevision);
		}
	})();
}
