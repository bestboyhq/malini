import type { JobSettingKey, JobSettings } from '$lib/app/domain/job-settings';

class JobSettingsStore {
	settings = $state.raw<JobSettings | null>(null);

	replace(settings: JobSettings | null): void {
		this.settings = settings;
	}

	set(key: JobSettingKey, value: number): void {
		if (this.settings === null) return;
		this.settings = { ...this.settings, [key]: value };
	}
}

export const jobSettingsStore = new JobSettingsStore();
