import type { JobSettings } from '$lib/app/domain/job-settings';

class JobSettingsStore {
	settings = $state.raw<JobSettings | null>(null);

	replace(settings: JobSettings | null): void {
		this.settings = settings;
	}

	set<Key extends keyof JobSettings>(key: Key, value: JobSettings[Key]): void {
		if (this.settings === null) return;
		this.settings = { ...this.settings, [key]: value };
	}
}

export const jobSettingsStore = new JobSettingsStore();
