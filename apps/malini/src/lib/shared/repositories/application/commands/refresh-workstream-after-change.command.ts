import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';
import { page } from '$shared/router/state';

export { refreshWorkstreamAfterChangeCommand };

function refreshWorkstreamAfterChangeCommand(workstreamId: string): void {
	if (workstreamId === (page.params.workstreamId ?? '')) {
		void activeWorkstreamFreshnessStore.refreshNow({ totals: true, localRepository: true });
		return;
	}
	void workstreamChangeTotalsAggregate.refreshWorkstream(workstreamId);
}
