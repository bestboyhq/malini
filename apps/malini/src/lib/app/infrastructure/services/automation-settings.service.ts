import { invoke } from '$shared/port/invoke';
import {
	automationSettingsFromStored,
	type AutomationSettings,
} from '$lib/app/domain/automation-settings';

class AutomationSettingsService {
	async read(): Promise<AutomationSettings> {
		return automationSettingsFromStored(await invoke('app.list-settings', undefined));
	}

	write(key: keyof AutomationSettings, value: string): Promise<void> {
		return invoke('app.set-setting', { key, value });
	}
}

export const automationSettingsService = new AutomationSettingsService();
