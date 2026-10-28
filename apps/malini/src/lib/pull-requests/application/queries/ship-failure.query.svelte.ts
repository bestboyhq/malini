import type { ShipFailure } from '$contract/pull-requests';
import { shipFailure } from '$lib/pull-requests/domain/ship-failure';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

export { shipFailureQuery };
export type { ShipFailure };

class ShipFailureQuery {
	public readonly data: (workstreamId: string) => ShipFailure | null = $derived(
		(workstreamId: string) => shipFailure(pullRequestShipAggregate.shipFor(workstreamId)),
	);
}

const shipFailureQuery = new ShipFailureQuery();
