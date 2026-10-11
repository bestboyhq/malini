import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routineJobsService } from '$lib/routines/infrastructure/services/routine-jobs.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { routineFormStore } from '$lib/routines/infrastructure/stores/routine-form.store.svelte';

export { clearRoutineFormSeedCommand };

function clearRoutineFormSeedCommand(): void {
	const seed = routineFormStore.seed;
	routineFormStore.seed = null;
	if (!seed) return;
	const suggestedJobIds = seed.steps.flatMap((step) => ('job' in step ? [step.job] : []));
	void routineActionsStore.run(seed.suggestionId, async () => {
		for (const jobId of suggestedJobIds) {
			await routineJobsService.remove(jobId);
			routinesAggregate.applyJob(jobId, null);
		}
	});
}
