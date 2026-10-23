import type { JobSuggestionRecord } from '$contract/jobs';
import { goto } from '$shared/router/navigation';
import { jobHref } from '$shared/router/routes-hrefs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobSuggestionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-suggestions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { acceptJobSuggestionCommand };

function acceptJobSuggestionCommand(suggestion: JobSuggestionRecord): void {
	void jobActionsStore.run(suggestion.id, async () => {
		const job = await jobsService.acceptSuggestion(suggestion.id);
		jobDefinitionsAggregate.upsert(job);
		jobSuggestionsAggregate.apply({ ...suggestion, status: 'accepted' });
		await goto(jobHref(job.id));
	});
}
