import {
	mergeStoppedOnAutomation,
	type MergeStoppedOnAutomation,
} from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';

export { mergeStoppedOnAutomationQuery };
export type { MergeStoppedOnAutomation };

class MergeStoppedOnAutomationQuery {
	public readonly data: (workstreamId: string) => MergeStoppedOnAutomation | null = $derived(
		(workstreamId: string) =>
			mergeStoppedOnAutomation(pullRequestShipAggregate.shipFor(workstreamId)),
	);
}

const mergeStoppedOnAutomationQuery = new MergeStoppedOnAutomationQuery();
