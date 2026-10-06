import { resumeDeferredPullRequestActionCommand } from '$lib/pull-requests/application/commands/resume-deferred-pull-request-action.command';
import { REPOSITORY_EXTENSION_COMMANDS } from '$lib/pull-requests/domain/pull-request-action';
import { repositorySurfaceAggregate } from '$lib/pull-requests/infrastructure/aggregates/repository-surface.aggregate.svelte';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';

export { loadRepositorySurfaceCommand };

function loadRepositorySurfaceCommand(workstreamId: string): void {
	if (!workstreamId || !repositoryExtensionService.isReadyFor(workstreamId)) return;
	const generation = repositorySurfaceAggregate.beginLoad(workstreamId);

	void (async () => {
		try {
			const outcome = await repositoryExtensionService.execute(
				workstreamId,
				REPOSITORY_EXTENSION_COMMANDS.status,
			);
			if (!repositorySurfaceAggregate.loadIsCurrent(workstreamId, generation)) return;
			repositorySurfaceAggregate.accept(workstreamId, outcome.surface);
			repositorySurfaceAggregate.finishLoad(workstreamId, generation, 'loaded');
			resumeDeferredPullRequestActionCommand(workstreamId);
		} catch {
			if (!repositorySurfaceAggregate.loadIsCurrent(workstreamId, generation)) return;
			repositorySurfaceAggregate.finishLoad(workstreamId, generation, 'failed');
			if (pullRequestActionStore.deferredFor(workstreamId)) pullRequestActionStore.dropDeferred();
		}
	})();
}
