import { jobSuggestionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-suggestions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { dismissJobSuggestionCommand };

function dismissJobSuggestionCommand(suggestionId: string): void {
	void jobActionsStore.run(suggestionId, async () => {
		jobSuggestionsAggregate.apply(await jobsService.dismissSuggestion(suggestionId));
	});
}
