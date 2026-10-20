import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { refreshWorkstreamsCommand };

function refreshWorkstreamsCommand(): void {
	void workstreamsAggregate.refresh();
}
