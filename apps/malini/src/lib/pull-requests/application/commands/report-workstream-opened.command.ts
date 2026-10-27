import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';

export { reportWorkstreamOpenedCommand };

function reportWorkstreamOpenedCommand(workstreamId: string): void {
	void pullRequestShipService.opened(workstreamId).catch(() => undefined);
}
