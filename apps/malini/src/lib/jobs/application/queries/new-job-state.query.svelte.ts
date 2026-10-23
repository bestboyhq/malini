import {
	jobActionsStore,
	NEW_JOB_ACTION_ID,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { newJobStateQuery };

class NewJobStateQuery {
	public readonly data: Readonly<{ busy: boolean; error: string | null; completed: number }> =
		$derived({
			busy: jobActionsStore.isBusy(NEW_JOB_ACTION_ID),
			error: jobActionsStore.errorFor(NEW_JOB_ACTION_ID),
			completed: jobActionsStore.completedFor(NEW_JOB_ACTION_ID),
		});
}

const newJobStateQuery = new NewJobStateQuery();
