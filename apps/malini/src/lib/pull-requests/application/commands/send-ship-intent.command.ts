import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { pullRequestActionFailureDetail } from '$lib/pull-requests/domain/pull-request-action';
import type { PullRequestShipIntent } from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestShipService } from '$lib/pull-requests/infrastructure/services/pull-request-ship.service';
import { pullRequestActionStore } from '$lib/pull-requests/infrastructure/stores/pull-request-action.store.svelte';

export { sendShipIntentCommand };

const BUSY_LABELS: Readonly<Record<PullRequestShipIntent, string>> = {
	'open-draft': 'Opening draft',
	'queue-merge': 'Queueing merge',
	'cancel-merge': 'Cancelling merge',
	'retry-merge': 'Retrying merge',
	'keep-workstream': 'Keeping the workstream',
};

const FAILURES: Readonly<Record<PullRequestShipIntent, string>> = {
	'open-draft': 'The draft pull request could not be opened',
	'queue-merge': 'The merge could not be queued',
	'cancel-merge': 'The merge could not be cancelled',
	'retry-merge': 'The merge could not be retried',
	'keep-workstream': 'The workstream could not be kept',
};

function sendShipIntentCommand(intent: PullRequestShipIntent, workstreamId: string): void {
	if (!workstreamId || pullRequestActionStore.busy) return;
	const revision = pullRequestActionStore.claim(BUSY_LABELS[intent]);
	void (async () => {
		try {
			pullRequestShipAggregate.accept(
				workstreamId,
				await pullRequestShipService.send(intent, workstreamId),
			);
		} catch (error) {
			toast.error(
				`Pull request action failed · ${pullRequestActionFailureDetail(error, FAILURES[intent])}`,
				aboutWorkstream(workstreamId),
			);
		} finally {
			pullRequestActionStore.release(revision);
		}
	})();
}
