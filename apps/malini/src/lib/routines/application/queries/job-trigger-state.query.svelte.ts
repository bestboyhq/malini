import { jobTriggerActionId } from '$lib/routines/domain/routine-action';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';

export { jobTriggerStateQuery };

class JobTriggerStateQuery {
	public readonly data: (jobId: string) => Readonly<{ busy: boolean; error: string | null }> =
		$derived((jobId: string) => ({
			busy: routineActionsStore.isBusy(jobTriggerActionId(jobId)),
			error: routineActionsStore.errorFor(jobTriggerActionId(jobId)),
		}));
}

const jobTriggerStateQuery = new JobTriggerStateQuery();
