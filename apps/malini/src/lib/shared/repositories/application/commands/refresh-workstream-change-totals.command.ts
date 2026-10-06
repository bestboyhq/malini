import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

export { refreshWorkstreamChangeTotalsCommand };

function refreshWorkstreamChangeTotalsCommand(workstreamId: string): void {
	void workstreamChangeTotalsAggregate.refreshWorkstream(workstreamId);
}
