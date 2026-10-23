import {
	jobActionsStore,
	jobSettingsActionId,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { jobSettingsStateQuery };

class JobSettingsStateQuery {
	public readonly data: (jobId: string) => Readonly<{ busy: boolean; error: string | null }> =
		$derived((jobId: string) => ({
			busy: jobActionsStore.isBusy(jobSettingsActionId(jobId)),
			error: jobActionsStore.errorFor(jobSettingsActionId(jobId)),
		}));
}

const jobSettingsStateQuery = new JobSettingsStateQuery();
