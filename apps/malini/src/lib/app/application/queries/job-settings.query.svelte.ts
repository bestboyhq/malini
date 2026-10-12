import type { JobSettings } from '$lib/app/domain/job-settings';
import { jobSettingsStore } from '$lib/app/infrastructure/stores/job-settings.store.svelte';

class JobSettingsQuery {
	public readonly data: JobSettings | null = $derived(jobSettingsStore.settings);
}

export const jobSettingsQuery = new JobSettingsQuery();
