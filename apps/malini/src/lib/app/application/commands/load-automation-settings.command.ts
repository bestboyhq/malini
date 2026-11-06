import { automationSettingsService } from '$lib/app/infrastructure/services/automation-settings.service';
import { automationSettingsStore } from '$lib/app/infrastructure/stores/automation-settings.store.svelte';

export function loadAutomationSettingsCommand(): void {
	void (async () => {
		try {
			automationSettingsStore.replace(await automationSettingsService.read());
		} catch (error) {
			automationSettingsStore.replace(null);
			console.error('[malini app] could not read the automation settings', error);
		}
	})();
}
