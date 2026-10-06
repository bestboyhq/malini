import type { WorkstreamChangeTarget } from '$shared/repositories/domain/workstream';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

export { trackWorkstreamChangeTotalsCommand };

function trackWorkstreamChangeTotalsCommand(targets: readonly WorkstreamChangeTarget[]): void {
	void workstreamChangeTotalsAggregate.track(targets);
}
