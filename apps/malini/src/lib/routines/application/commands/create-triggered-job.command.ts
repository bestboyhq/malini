import type { JobTrigger } from '$contract/routines';
import { ROUTINE_NEW_JOB_ACTION_ID } from '$lib/routines/domain/routine-action';
import type { NewRoutineJob } from '$lib/routines/domain/routine-job';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routineJobsService } from '$lib/routines/infrastructure/services/routine-jobs.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { setJobTriggerCommand } from './set-job-trigger.command';

export { createTriggeredJobCommand };

function createTriggeredJobCommand(job: NewRoutineJob, trigger: JobTrigger | null): void {
	void routineActionsStore.run(ROUTINE_NEW_JOB_ACTION_ID, async () => {
		const created = await routineJobsService.save(job);
		routinesAggregate.applyJob(created.id, created);
		if (trigger !== null) setJobTriggerCommand(created, trigger);
	});
}
