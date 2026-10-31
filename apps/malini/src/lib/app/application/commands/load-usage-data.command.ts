import { usageDataService } from '$lib/app/infrastructure/services/usage-data.service';
import { usageDataStore } from '$lib/app/infrastructure/stores/usage-data.store.svelte';

export function loadUsageDataCommand(): void {
	void (async () => {
		try {
			const [shared, report] = await Promise.all([
				usageDataService.read(),
				usageDataService.report(),
			]);
			usageDataStore.set(shared);
			usageDataStore.setReport(report);
		} catch (error) {
			usageDataStore.set(null);
			console.error('[malini app] could not read the usage data setting', error);
		}
	})();
}
