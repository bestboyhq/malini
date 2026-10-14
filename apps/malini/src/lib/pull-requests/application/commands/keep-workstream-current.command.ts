import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';

export { keepWorkstreamCurrentCommand };

function keepWorkstreamCurrentCommand(workstreamId: string): void {
	void pullRequestShipService.opened(workstreamId).catch(() => undefined);
}
