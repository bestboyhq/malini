import type { AutomationSettings } from '$lib/app/domain/automation-settings';
import { automationSettingsService } from '$lib/app/infrastructure/services/automation-settings.service';
import { automationSettingsStore } from '$lib/app/infrastructure/stores/automation-settings.store.svelte';

export function saveAutomationSettingCommand<Key extends keyof AutomationSettings>(
	key: Key,
	value: AutomationSettings[Key],
): void {
	const previous = automationSettingsStore.settings;
	if (previous === null || value === previous[key]) return;
	automationSettingsStore.set(key, value);
	void (async () => {
		try {
			await automationSettingsService.write(key, String(value));
		} catch (error) {
			automationSettingsStore.set(key, previous[key]);
			console.error(`[malini app] could not save the ${key} setting`, error);
		}
	})();
}
