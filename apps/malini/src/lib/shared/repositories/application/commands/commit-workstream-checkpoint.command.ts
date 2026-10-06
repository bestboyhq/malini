import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { workstreamActionFailureMessage } from '$shared/repositories/domain/workstream-action';
import { workstreamsService } from '$shared/repositories/infrastructure/services/workstreams.service';
import { workstreamActionsStore } from '$shared/repositories/infrastructure/stores/workstream-actions.store.svelte';
import { loadWorkstreamGitStatusCommand } from './load-workstream-git-status.command';

export { commitWorkstreamCheckpointCommand };

function commitWorkstreamCheckpointCommand(workstreamId: string, onSettled?: () => void): void {
	if (workstreamActionsStore.busyFor(workstreamId)) return;
	workstreamActionsStore.begin(workstreamId, 'commit');
	void (async () => {
		try {
			const { sha, message } = await workstreamsService.commitCheckpoint(workstreamId);
			toast.success(
				`Committed ${sha} to this workstream · ${message}`,
				aboutWorkstream(workstreamId),
			);
			loadWorkstreamGitStatusCommand(workstreamId);
		} catch (cause) {
			toast.error(
				workstreamActionFailureMessage(cause, 'Commit failed'),
				aboutWorkstream(workstreamId),
			);
		} finally {
			workstreamActionsStore.finish(workstreamId);
			onSettled?.();
		}
	})();
}
