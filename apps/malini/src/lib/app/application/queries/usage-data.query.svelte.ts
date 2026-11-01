import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

type UsageData = Readonly<{ shared: boolean | null; doNotTrack: boolean }>;

class UsageDataQuery {
	public readonly data: UsageData = $derived({
		shared: usageDataStore.doNotTrack ? false : usageDataStore.shared,
		doNotTrack: usageDataStore.doNotTrack,
	});
}

export const usageDataQuery = new UsageDataQuery();
