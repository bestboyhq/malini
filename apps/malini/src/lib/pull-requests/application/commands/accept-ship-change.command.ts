import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';
import { goto } from '$shared/router/navigation';
import { REPOSITORIES_HREF, workstreamHref } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import {
	pullRequestNeedsYouAnnouncement,
	type PullRequestShipChange,
} from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

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
	if (change.mergedPullRequestNumber !== null && page.params.workstreamId === workstreamId) {
		void goto(REPOSITORIES_HREF);
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
