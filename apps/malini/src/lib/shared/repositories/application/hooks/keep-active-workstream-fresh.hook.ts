import { EXTENSION_EVENTS } from '@malini/extension-api';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import type { PullRequestActivity } from '$shared/repositories/domain/workstream-freshness';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';

export function keepActiveWorkstreamFreshHook(
	pullRequestActivity: (workstreamId: string) => PullRequestActivity,
): () => void {
	activeWorkstreamFreshnessStore.start({
		pullRequestActivity,
		ensureTotals: (workstreamId) => workstreamChangeTotalsAggregate.ensureWorkstream(workstreamId),
		refreshTotals: (workstreamId) =>
			workstreamChangeTotalsAggregate.refreshWorkstream(workstreamId),
		refreshLocalRepository: async (workstreamId) => {
			await Promise.all([
				requestExtensionRepositoryRefresh(workstreamId, 'local'),
				workstreamGitStatusAggregate.load(workstreamId),
			]);
		},
		refreshPullRequest: (workstreamId) =>
			requestExtensionRepositoryRefresh(workstreamId, 'pull-request'),
	});
	return () => {
		activeWorkstreamFreshnessStore.stop();
	};
}

function requestExtensionRepositoryRefresh(
	workstreamId: string,
	scope: 'local' | 'pull-request',
): Promise<void> {
	return extensionCommands.emit(workstreamId, EXTENSION_EVENTS.repositoryRefreshRequested, {
		workstreamId,
		scope,
	});
}
