import { usageDataService } from '$lib/app/infrastructure/services/usage-data.service';
import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

export function loadUsageDataCommand(): void {
	void (async () => {
		try {
			usageDataStore.set(await usageDataService.read());
		} catch (error) {
			usageDataStore.set(null);
			console.error('[malini app] could not read the usage data setting', error);
		}
	})();
}
