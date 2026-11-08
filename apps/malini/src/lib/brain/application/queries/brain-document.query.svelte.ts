import type { BrainDocumentState } from '$lib/brain/domain/brain';
import { brainAggregate } from '$lib/brain/infrastructure/aggregates/brain.aggregate.svelte';

export { brainDocumentQuery };

class BrainDocumentQuery {
	public readonly data: (path: string) => BrainDocumentState = $derived(
		(path: string) => brainAggregate.documentOf(path) ?? { status: 'loading' },
	);
}

const brainDocumentQuery = new BrainDocumentQuery();
