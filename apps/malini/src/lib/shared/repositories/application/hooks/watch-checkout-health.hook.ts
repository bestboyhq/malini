import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';

export function watchCheckoutHealthHook(): () => void {
	return checkoutHealthAggregate.follow((workstreamId) => {
		if (activeWorkstreamFreshnessStore.workstreamId === workstreamId) {
			void activeWorkstreamFreshnessStore.refreshNow();
			return;
		}
		void workstreamChangeTotalsAggregate.refreshWorkstream(workstreamId);
	});
}
