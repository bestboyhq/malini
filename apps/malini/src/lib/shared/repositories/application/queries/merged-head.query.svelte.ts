import type { MergedHead } from '$shared/repositories/domain/workstream';
import { mergedHeadsAggregate } from '$shared/repositories/infrastructure/aggregates/merged-heads.aggregate.svelte';

export { mergedHeadQuery };

class MergedHeadQuery {
	public readonly data: (workstreamId: string) => MergedHead | null = $derived(
		(workstreamId: string) => mergedHeadsAggregate.headFor(workstreamId),
	);
}

const mergedHeadQuery = new MergedHeadQuery();
