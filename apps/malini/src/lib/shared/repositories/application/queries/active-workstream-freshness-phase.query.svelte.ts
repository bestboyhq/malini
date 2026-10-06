import type { ActiveWorkstreamFreshnessPhase } from '$shared/repositories/domain/workstream-freshness';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';

export { activeWorkstreamFreshnessPhaseQuery };

class ActiveWorkstreamFreshnessPhaseQuery {
	public readonly data: ActiveWorkstreamFreshnessPhase = $derived(
		activeWorkstreamFreshnessStore.phase,
	);
}

const activeWorkstreamFreshnessPhaseQuery = new ActiveWorkstreamFreshnessPhaseQuery();
