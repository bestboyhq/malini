import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { jobActionStateQuery };

class JobActionStateQuery {
	public readonly data: (id: string) => Readonly<{ busy: boolean; error: string | null }> =
		$derived((id: string) => ({
			busy: jobActionsStore.isBusy(id),
			error: jobActionsStore.errorFor(id),
		}));
}

const jobActionStateQuery = new JobActionStateQuery();
