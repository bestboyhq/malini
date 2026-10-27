import type { ShipAllButton } from '$contract/pull-requests';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';

export { shipAllCommand };

const FAILURES: Readonly<Record<ShipAllButton, string>> = {
	'draft-all': 'The draft pull requests could not be opened',
	'merge-all': 'The merges could not be queued',
};

function shipAllCommand(
	button: ShipAllButton,
	workstreamId: string,
	workstreamIds: readonly string[],
	chatSessionId: string | null,
): void {
	void pullRequestShipService
		.clickAll({ workstreamId, button, workstreamIds, chatSessionId })
		.catch((error: unknown) => {
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, FAILURES[button])}`,
				aboutWorkstream(workstreamId),
			);
		});
}
