import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

export function trackWorkstreamChangeTotalsHook(): () => void {
	const stopPolling = workstreamChangeTotalsAggregate.startPolling();
	void workstreamChangeTotalsAggregate.refreshAll();
	return stopPolling;
}
