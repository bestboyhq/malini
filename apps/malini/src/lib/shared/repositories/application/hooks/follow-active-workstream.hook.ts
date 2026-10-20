import { scheduleAfterSettledNavigationPaint } from '$shared/performance/navigation-paint-scheduler';
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
	return scheduleAfterSettledNavigationPaint(() => {
		activeWorkstreamFreshnessStore.phase = 'released-after-paint';
		activeWorkstreamFreshnessStore.setWorkstream(workstreamId);
	});
}
