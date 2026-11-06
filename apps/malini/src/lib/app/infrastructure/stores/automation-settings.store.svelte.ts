import type { AutomationSettings } from '$lib/app/domain/automation-settings';

class AutomationSettingsStore {
	settings = $state.raw<AutomationSettings | null>(null);

	replace(settings: AutomationSettings | null): void {
		this.settings = settings;
	}

	set<Key extends keyof AutomationSettings>(key: Key, value: AutomationSettings[Key]): void {
		if (this.settings === null) return;
		this.settings = { ...this.settings, [key]: value };
	}
}

export const automationSettingsStore = new AutomationSettingsStore();
