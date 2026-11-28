import { browserProfilesAggregate } from '../../infrastructure/aggregates/browser-profiles.aggregate.svelte';

export { browserProfilesQuery };

class BrowserProfilesQuery {
	public readonly data: readonly string[] = $derived(browserProfilesAggregate.names);
}

const browserProfilesQuery = new BrowserProfilesQuery();
