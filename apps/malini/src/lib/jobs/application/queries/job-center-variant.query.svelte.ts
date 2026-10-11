import { jobCenterVariantStore } from '$lib/jobs/infrastructure/stores/job-center-variant.store.svelte';

export { jobCenterVariantQuery };

class JobCenterVariantQuery {
	public readonly data: 'pill' | 'docked' | 'stack' = $derived(jobCenterVariantStore.variant);
}

const jobCenterVariantQuery = new JobCenterVariantQuery();
