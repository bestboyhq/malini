import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import {
	pullRequestShipAnnouncement,
	type PullRequestShipChange,
} from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

export { acceptShipChangeCommand };

function acceptShipChangeCommand(change: PullRequestShipChange, workstreamName: string): void {
	const { workstreamId } = change;
	const previous = pullRequestShipAggregate.shipFor(workstreamId);
	pullRequestShipAggregate.accept(workstreamId, change.ship);
	const merged = change.mergedPullRequestNumber !== null;
	if (merged && page.params.workstreamId === workstreamId) void goto(REPOSITORIES_HREF);

	const announcement = pullRequestShipAnnouncement(previous, change, workstreamName);
	if (!announcement) return;
	toast[announcement.level](
		announcement.message,
		aboutWorkstream(
			workstreamId,
			merged
				? {}
				: { action: { label: 'Open', onclick: () => void goto(workstreamHref(workstreamId)) } },
		),
	);
}
