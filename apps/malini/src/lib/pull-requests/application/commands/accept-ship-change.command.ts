import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { workstreamHref } from '$shared/router/routes-hrefs';
import {
	pullRequestNeedsYouAnnouncement,
	type PullRequestShipChange,
} from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { pullRequestStateAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-state.aggregate.svelte';

export { acceptShipChangeCommand };

type Lead = Readonly<{ workstreamId: string; name: string }>;

function acceptShipChangeCommand(
	change: PullRequestShipChange,
	workstreamName: string,
	lead: Lead | null,
): void {
	const { workstreamId } = change;
	const previous = pullRequestShipAggregate.shipFor(workstreamId);
	pullRequestShipAggregate.accept(workstreamId, change.ship);
	if (change.mergedPullRequestNumber !== null) {
		pullRequestStateAggregate.observe(workstreamId, 'merged');
	}

	const announcement = pullRequestNeedsYouAnnouncement(previous, change, workstreamName);
	if (!announcement) return;
	const opens = lead?.workstreamId ?? workstreamId;
	toast.warning(
		lead ? `${lead.name} · ${announcement}` : announcement,
		aboutWorkstream(workstreamId, {
			action: { label: 'Open', onclick: () => void goto(workstreamHref(opens)) },
		}),
	);
}
