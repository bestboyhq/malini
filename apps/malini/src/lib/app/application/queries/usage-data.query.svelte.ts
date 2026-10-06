import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

class UsageDataQuery {
	public readonly data: boolean | null = $derived(usageDataStore.shared);
}

export const usageDataQuery = new UsageDataQuery();
