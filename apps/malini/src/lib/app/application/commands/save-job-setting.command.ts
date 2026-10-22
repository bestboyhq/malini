import type { JobSettings } from '$lib/app/domain/job-settings';
import { jobSettingsService } from '$lib/app/infrastructure/services/job-settings.service';
import { jobSettingsStore } from '$lib/app/infrastructure/stores/job-settings.store.svelte';

export function saveJobSettingCommand<Key extends keyof JobSettings>(
	key: Key,
	value: JobSettings[Key],
): void {
	const previous = jobSettingsStore.settings;
	if (previous === null || value === previous[key]) return;
	jobSettingsStore.set(key, value);
	void (async () => {
		try {
			await jobSettingsService.write(key, String(value));
		} catch (error) {
			jobSettingsStore.set(key, previous[key]);
			console.error(`[malini app] could not save the ${key} setting`, error);
		}
	})();
}
