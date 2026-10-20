import { MANUAL_AUTOMATION_PHRASE } from '$contract/automation-trigger';
import { suggestedRoutineJob } from '$lib/routines/domain/routine-job';
import type { RoutineSuggestion } from '$lib/routines/domain/routine-suggestion';
import { routinesAggregate } from '$lib/routines/infrastructure/aggregates/routines.aggregate.svelte';
import { routineJobsService } from '$lib/routines/infrastructure/services/routine-jobs.service';
import { routineActionsStore } from '$lib/routines/infrastructure/stores/routine-actions.store.svelte';
import { routineFormStore } from '$lib/routines/infrastructure/stores/routine-form.store.svelte';

export { acceptRoutineSuggestionCommand };

function acceptRoutineSuggestionCommand(suggestion: RoutineSuggestion): void {
	void routineActionsStore.run(suggestion.id, async () => {
		const draft = suggestedRoutineJob(suggestion);
		if (!draft) throw new Error('This suggestion has no prompt to turn into a job.');
		const job = await routineJobsService.create(draft);
		routinesAggregate.applyJob(job.id, job);
		routineFormStore.seed = {
			label: job.name,
			when: MANUAL_AUTOMATION_PHRASE,
			steps: [{ job: job.id }],
			suggestionId: suggestion.id,
			evidenceCount: suggestion.evidence.length,
		};
	});
}
