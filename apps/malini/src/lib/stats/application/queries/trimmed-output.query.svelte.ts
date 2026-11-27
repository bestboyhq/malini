import type { TrimmedOutput } from '$contract/stats';
import { trimmedOutputAggregate } from '$lib/stats/infrastructure/aggregates/trimmed-output.aggregate.svelte';

export { trimmedOutputQuery };

class TrimmedOutputQuery {
	public readonly data: TrimmedOutput | null = $derived(trimmedOutputAggregate.trimmed);
}

const trimmedOutputQuery = new TrimmedOutputQuery();
