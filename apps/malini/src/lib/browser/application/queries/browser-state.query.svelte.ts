import type { BrowserState } from '$contract/browser';

import { browserStatesAggregate } from '../../infrastructure/aggregates/browser-states.aggregate.svelte';

export { browserStateQuery };

class BrowserStateQuery {
	public readonly data: (tabKey: string) => BrowserState | null = $derived(
		(tabKey: string) => browserStatesAggregate.byTab[tabKey] ?? null,
	);
}

const browserStateQuery = new BrowserStateQuery();
