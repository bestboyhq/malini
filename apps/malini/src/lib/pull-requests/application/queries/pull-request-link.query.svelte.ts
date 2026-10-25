import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

export { pullRequestLinkQuery };

export type PullRequestLink = Readonly<{ number: number; url: string }>;

class PullRequestLinkQuery {
	public readonly data: (workstreamId: string) => PullRequestLink | null = $derived(
		(workstreamId: string) => {
			const ship = pullRequestShipAggregate.shipFor(workstreamId);
			return ship?.pullRequestNumber && ship.pullRequestUrl
				? { number: ship.pullRequestNumber, url: ship.pullRequestUrl }
				: null;
		},
	);
}

const pullRequestLinkQuery = new PullRequestLinkQuery();
