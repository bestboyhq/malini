import { usageDataService } from '$lib/app/infrastructure/services/usage-data.service';
import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

export function shareUsageDataCommand(shared: boolean): void {
	const previous = usageDataStore.shared;
	usageDataStore.set(shared);
	void (async () => {
		try {
			await usageDataService.write(shared);
		} catch (error) {
			usageDataStore.set(previous);
			console.error('[malini app] could not save the usage data setting', error);
		}
	})();
}
