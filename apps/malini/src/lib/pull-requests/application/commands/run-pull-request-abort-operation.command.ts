import { toast } from '$hyper-ui/components/toast';
import type { WorktreeOperation } from '$contract/repositories';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	pullRequestActionFailureDetail,
} from '$lib/pull-requests/domain/pull-request-action';
import { awaitPullRequestActionScope } from '$lib/pull-requests/domain/pull-request-action-scope';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestAbortOperationCommand };

function runPullRequestAbortOperationCommand(
	operation: WorktreeOperation,
	onGitStatusStale: () => void,
): void {
	if (pullRequestActionStore.busy) return;
	const scope = pullRequestScopeStore.claim(`Aborting ${operation}…`);
	if (!scope) return;
	void (async () => {
		try {
			const outcome = await awaitPullRequestActionScope(
				scope,
				repositoryExtensionService.execute(
					scope.workstreamId,
					REPOSITORY_EXTENSION_COMMANDS.abortOperation,
				),
				() => pullRequestScopeStore.snapshot(),
			);
			if (!outcome || !pullRequestScopeStore.isCurrent(scope)) return;
			repositorySurfaceAggregate.accept(scope.workstreamId, outcome.surface);
			onGitStatusStale();
		} catch (error) {
			if (!pullRequestScopeStore.isCurrent(scope)) return;
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, `The ${operation} could not be aborted`)}`,
				aboutWorkstream(scope.workstreamId),
			);
		} finally {
			pullRequestActionStore.release(scope.actionRevision);
		}
	})();
}
