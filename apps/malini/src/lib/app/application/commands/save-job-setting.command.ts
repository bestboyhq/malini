import { clampJobSetting, type JobSettingKey } from '$lib/app/domain/job-settings';
import { jobSettingsService } from '$lib/app/infrastructure/services/job-settings.service';
import { jobSettingsStore } from '$lib/app/infrastructure/stores/job-settings.store.svelte';

export function saveJobSettingCommand(key: JobSettingKey, value: number): void {
	const previous = jobSettingsStore.settings;
	if (previous === null) return;
	const next = clampJobSetting(key, value);
	if (next === previous[key]) return;
	jobSettingsStore.set(key, next);
	void (async () => {
		try {
			await jobSettingsService.write(key, next);
		} catch (error) {
			jobSettingsStore.set(key, previous[key]);
			console.error(`[malini app] could not save the ${key} setting`, error);
		}
	})();
}
