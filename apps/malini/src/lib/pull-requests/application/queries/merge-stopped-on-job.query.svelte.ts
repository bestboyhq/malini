import {
	mergeStoppedOnJob,
	type MergeStoppedOnJob,
} from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

export { mergeStoppedOnJobQuery };
export type { MergeStoppedOnJob };

class MergeStoppedOnJobQuery {
	public readonly data: (workstreamId: string) => MergeStoppedOnJob | null = $derived(
		(workstreamId: string) => mergeStoppedOnJob(pullRequestShipAggregate.shipFor(workstreamId)),
	);
}

const mergeStoppedOnJobQuery = new MergeStoppedOnJobQuery();
