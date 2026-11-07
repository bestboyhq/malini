import type { AutomationSettings } from '$lib/app/domain/automation-settings';
import { automationSettingsStore } from '$lib/app/infrastructure/stores/automation-settings.store.svelte';

class AutomationSettingsQuery {
	public readonly data: AutomationSettings | null = $derived(automationSettingsStore.settings);
}

export const automationSettingsQuery = new AutomationSettingsQuery();
