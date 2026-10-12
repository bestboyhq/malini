import { invoke } from '$shared/port/invoke';
import {
	jobSettingsFromStored,
	type JobSettingKey,
	type JobSettings,
} from '$lib/app/domain/job-settings';

class JobSettingsService {
	async read(): Promise<JobSettings> {
		return jobSettingsFromStored(await invoke('app.list-settings', undefined));
	}

	write(key: JobSettingKey, value: number): Promise<void> {
		return invoke('app.set-setting', { key, value: String(value) });
	}
}

export const jobSettingsService = new JobSettingsService();
