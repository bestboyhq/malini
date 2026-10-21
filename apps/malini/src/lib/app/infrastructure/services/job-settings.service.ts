import { invoke } from '$shared/port/invoke';
import { jobSettingsFromStored, type JobSettings } from '$lib/app/domain/job-settings';

class JobSettingsService {
	async read(): Promise<JobSettings> {
		return jobSettingsFromStored(await invoke('app.list-settings', undefined));
	}

	write(key: keyof JobSettings, value: string): Promise<void> {
		return invoke('app.set-setting', { key, value });
	}
}

export const jobSettingsService = new JobSettingsService();
