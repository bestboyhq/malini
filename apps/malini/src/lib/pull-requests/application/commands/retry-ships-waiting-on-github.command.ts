import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';

export { retryShipsWaitingOnGithubCommand };

function retryShipsWaitingOnGithubCommand(): void {
	const waiting = Object.values(pullRequestShipAggregate.shipByWorkstream).filter(
		(ship) => ship.waitsFor !== null,
	);
	for (const { workstreamId } of waiting) {
		void (async () => {
			try {
				pullRequestShipAggregate.accept(
					workstreamId,
					await pullRequestShipService.send('retry-now', workstreamId),
				);
			} catch (error) {
				toast.error(
					`Pull request action failed · ${pullRequestActionFailureDetail(error, 'Malini could not retry')}`,
					aboutWorkstream(workstreamId),
				);
			}
		})();
	}
}
