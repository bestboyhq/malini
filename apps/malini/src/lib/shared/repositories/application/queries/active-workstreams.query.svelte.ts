import type { Workstream } from '$shared/repositories/domain/workstream';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { activeWorkstreamsQuery };

class ActiveWorkstreamsQuery {
	public readonly data: readonly Workstream[] = $derived(
		workstreamsAggregate.workstreams.filter((workstream) => workstream.status !== 'archived'),
	);
}

const activeWorkstreamsQuery = new ActiveWorkstreamsQuery();
