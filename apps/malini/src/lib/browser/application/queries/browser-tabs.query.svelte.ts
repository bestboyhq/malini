import type { BrowserTab } from '../../domain/browser-tab';
import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';

export { browserTabsQuery };

class BrowserTabsQuery {
	public readonly data: (workstreamId: string) => readonly BrowserTab[] = $derived(
		(workstreamId: string) => browserTabsAggregate.byWorkstream[workstreamId] ?? [],
	);
}

const browserTabsQuery = new BrowserTabsQuery();
