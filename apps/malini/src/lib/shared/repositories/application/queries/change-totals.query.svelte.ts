import type { WorkstreamChangeTotals } from '$shared/repositories/domain/workstream-snapshot';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';

export { changeTotalsQuery };

class ChangeTotalsQuery {
	public readonly data: Readonly<Record<string, WorkstreamChangeTotals>> = $derived(
		workstreamChangeTotalsAggregate.totalsByWorkstream,
	);
}

const changeTotalsQuery = new ChangeTotalsQuery();
