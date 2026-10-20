import { invoke } from '$shared/port/invoke';
import { USAGE_DATA_SETTING, usageDataSetting, usageDataShared } from '$lib/app/domain/usage-data';

class UsageDataService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return usageDataShared(settings[USAGE_DATA_SETTING]);
	}

	write(shared: boolean): Promise<void> {
		return invoke('app.set-setting', { key: USAGE_DATA_SETTING, value: usageDataSetting(shared) });
	}
}

export const usageDataService = new UsageDataService();
