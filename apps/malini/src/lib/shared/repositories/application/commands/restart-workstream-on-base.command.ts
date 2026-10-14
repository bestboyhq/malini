import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { extensionRepositoryBindingService } from '$shared/repositories/infrastructure/services/extension-repository-binding.service';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';
import { loadWorkstreamGitStatusCommand } from './load-workstream-git-status.command';

export { restartWorkstreamOnBaseCommand };

function restartWorkstreamOnBaseCommand(
	workstreamId: string,
	merged: Readonly<{ baseBranch: string; mergedHeadSha: string }>,
	onSettled: () => void,
): void {
	if (workstreamActionsStore.busyFor(workstreamId)) {
		onSettled();
		return;
	}
	workstreamActionsStore.begin(workstreamId, 'continue');
	void (async () => {
		try {
			await extensionRepositoryBindingService.restartRepositoryOnBase(workstreamId, merged);
			loadWorkstreamGitStatusCommand(workstreamId);
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
