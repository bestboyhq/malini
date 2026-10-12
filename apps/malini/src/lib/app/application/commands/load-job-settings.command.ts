import { jobSettingsService } from '$lib/app/infrastructure/services/job-settings.service';
import { jobSettingsStore } from '$lib/app/infrastructure/stores/job-settings.store.svelte';

export function loadJobSettingsCommand(): void {
	void (async () => {
		try {
			jobSettingsStore.replace(await jobSettingsService.read());
		} catch (error) {
			jobSettingsStore.replace(null);
			console.error('[malini app] could not read the job settings', error);
		}
	})();
}
