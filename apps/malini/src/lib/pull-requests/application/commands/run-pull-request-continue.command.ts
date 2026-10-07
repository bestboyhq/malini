import { toast } from '$hyper-ui/components/toast';
import { acceptRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/accept-repository-surface.command';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	pullRequestActionFailureDetail,
} from '$lib/pull-requests/domain/pull-request-action';
import { awaitPullRequestActionScope } from '$lib/pull-requests/domain/pull-request-action-scope';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';
import { pullRequestScopeStore } from '$lib/pull-requests/infrastructure/stores/pull-request-scope.store.svelte';

export { runPullRequestContinueCommand };

function runPullRequestContinueCommand(onGitStatusStale: () => void): void {
	if (pullRequestActionStore.busy) return;
	const scope = pullRequestScopeStore.claim('Continuing…');
	if (!scope) return;
	void (async () => {
		try {
			const outcome = await awaitPullRequestActionScope(
				scope,
				repositoryExtensionService.execute(
					scope.workstreamId,
					REPOSITORY_EXTENSION_COMMANDS.continueAfterMerge,
				),
				() => pullRequestScopeStore.snapshot(),
			);
			if (!outcome || !pullRequestScopeStore.isCurrent(scope)) return;
			const surface = outcome.surface;
			acceptRepositorySurfaceCommand(scope.workstreamId, surface);
			onGitStatusStale();
			if (surface.operationInProgress === 'rebase') {
				toast.info(
					'Continuing stopped on conflicts. Resolve them to finish moving onto the base',
					aboutWorkstream(scope.workstreamId),
				);
			}
		} catch (error) {
			if (!pullRequestScopeStore.isCurrent(scope)) return;
			toast.error(
				`Continue failed · ${pullRequestActionFailureDetail(error, 'The workstream could not move onto its base')}`,
				aboutWorkstream(scope.workstreamId),
			);
		} finally {
			pullRequestActionStore.release(scope.actionRevision);
		}
	})();
}
