import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

export { ensureWorkstreamChangeTotalsCommand };

function ensureWorkstreamChangeTotalsCommand(workstreamId: string): void {
	void workstreamChangeTotalsAggregate.ensureWorkstream(workstreamId);
}
