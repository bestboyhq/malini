import { browserTabsAggregate } from '../../infrastructure/aggregates/browser-tabs.aggregate.svelte';

export { browserTabsQuery };

class BrowserTabsQuery {
	public readonly data: (workstreamId: string) => readonly string[] = $derived(
		(workstreamId: string) => browserTabsAggregate.byWorkstream[workstreamId] ?? [],
	);
}

const browserTabsQuery = new BrowserTabsQuery();
