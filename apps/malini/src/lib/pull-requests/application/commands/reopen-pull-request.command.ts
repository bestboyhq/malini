import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { refreshRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/refresh-repository-surface.command';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';

export { reopenPullRequestCommand };

function reopenPullRequestCommand(workstreamId: string, pullRequestNumber: number): void {
	const revision = pullRequestActionStore.claim('Reopening');
	void pullRequestShipService
		.reopen(workstreamId, pullRequestNumber)
		.catch((error: unknown) => {
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, `Pull request #${pullRequestNumber} could not be reopened`)}`,
				aboutWorkstream(workstreamId),
			);
		})
		.finally(() => {
			pullRequestActionStore.release(revision);
			refreshRepositorySurfaceCommand();
		});
}
