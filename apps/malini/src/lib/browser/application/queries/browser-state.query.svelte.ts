import type { BrowserState } from '$contract/browser';

import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';

export { browserStateQuery };

class BrowserStateQuery {
	public readonly data: (workstreamId: string) => BrowserState | null = $derived(
		(workstreamId: string) => browserStatesAggregate.byWorkstream[workstreamId] ?? null,
	);
}

const browserStateQuery = new BrowserStateQuery();
