import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { mergedHeadsAggregate } from '$shared/repositories/infrastructure/aggregates/merged-heads.aggregate.svelte';
import { extensionRepositoryBindingService } from '$shared/repositories/infrastructure/services/extension-repository-binding.service';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';
import { page } from '$shared/router/state';
import { loadWorkstreamGitStatusCommand } from './load-workstream-git-status.command';

export { restartWorkstreamOnBaseCommand };

function restartWorkstreamOnBaseCommand(workstreamId: string, onSettled: () => void): void {
	const merged = mergedHeadsAggregate.headFor(workstreamId);
	if (!merged || workstreamActionsStore.busyFor(workstreamId)) {
		onSettled();
		return;
	}
	workstreamActionsStore.begin(workstreamId, 'continue');
	void (async () => {
		try {
			await extensionRepositoryBindingService.restartRepositoryOnBase(workstreamId, merged);
			mergedHeadsAggregate.note(workstreamId, null);
			refreshRestartedWorkstream(workstreamId);
		} catch (cause) {
			toast.error(
				`Continue failed · ${workstreamActionFailureMessage(cause, 'The workstream could not move onto its base')}`,
				aboutWorkstream(workstreamId),
			);
		} finally {
			workstreamActionsStore.finish(workstreamId);
			onSettled();
		}
	})();
}

function refreshRestartedWorkstream(workstreamId: string): void {
	if (workstreamId === (page.params.workstreamId ?? '')) {
		void activeWorkstreamFreshnessStore.refreshNow();
		return;
	}
	loadWorkstreamGitStatusCommand(workstreamId);
}
