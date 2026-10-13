import {
	JOB_FORM_ACTION_ID,
	jobActionsStore,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { jobFormSubmissionQuery };

class JobFormSubmissionQuery {
	public readonly data: Readonly<{ busy: boolean; error: string | null; saves: number }> = $derived(
		{
			busy: jobActionsStore.isBusy(JOB_FORM_ACTION_ID),
			error: jobActionsStore.errorFor(JOB_FORM_ACTION_ID),
			saves: jobActionsStore.saves,
		},
	);
}

const jobFormSubmissionQuery = new JobFormSubmissionQuery();
