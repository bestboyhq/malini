import { jobCenterVariantStore } from '$lib/jobs/infrastructure/stores/job-center-variant.store.svelte';

export { hydrateJobCenterVariantCommand };

function hydrateJobCenterVariantCommand(): void {
	jobCenterVariantStore.hydrate();
}
