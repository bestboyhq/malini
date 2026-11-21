import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
import { checkoutHealthAggregate } from '$shared/repositories/infrastructure/aggregates/checkout-health.aggregate.svelte';
import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';

export function followActiveWorkstreamHook(workstreamId: string, checkedOut: boolean): () => void {
	activeWorkstreamFreshnessStore.setWorkstream(null);
	workstreamGitStatusAggregate.focus(workstreamId || null);
	if (!workstreamId) {
		activeWorkstreamFreshnessStore.phase = 'idle';
		return () => undefined;
	}
	activeWorkstreamFreshnessStore.phase = 'deferred';
	if (!checkedOut) return () => undefined;
	void checkoutHealthAggregate.load(workstreamId);
	return scheduleAfterSettledNavigationPaint(() => {
		activeWorkstreamFreshnessStore.phase = 'released-after-paint';
		activeWorkstreamFreshnessStore.setWorkstream(workstreamId);
	});
}
