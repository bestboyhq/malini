import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { acceptRepositorySurfaceCommand } from '$lib/pull-requests/application/commands/accept-repository-surface.command';
import {
	REPOSITORY_EXTENSION_COMMANDS,
	alreadyAddressedReviewThreadsMessage,
	reviewThreadsLeftOpenMessage,
} from '$lib/pull-requests/domain/pull-request-action';
import { repositoryExtensionService } from '$lib/pull-requests/infrastructure/services/repository-extension.service';
import { reviewThreadsService } from '$lib/pull-requests/infrastructure/services/review-threads.service';

export { resolveReviewThreadsAfterRunCommand };

function resolveReviewThreadsAfterRunCommand(workstreamId: string, runId: string): void {
	void (async () => {
		const { resolvedThreadIds, failures } = await reviewThreadsService.resolveAddressed(
			workstreamId,
			runId,
		);
		const leftOpen = reviewThreadsLeftOpenMessage(failures);
		if (leftOpen) toast.error(leftOpen, aboutWorkstream(workstreamId));
		if (resolvedThreadIds.length === 0) return;
		toast.success(
			alreadyAddressedReviewThreadsMessage(resolvedThreadIds.length),
			aboutWorkstream(workstreamId),
		);
		if (!repositoryExtensionService.isReadyFor(workstreamId)) return;
		const refreshed = await repositoryExtensionService
			.execute(workstreamId, REPOSITORY_EXTENSION_COMMANDS.refreshPullRequest)
			.catch(() => null);
		if (refreshed) acceptRepositorySurfaceCommand(workstreamId, refreshed.surface);
	})();
}
