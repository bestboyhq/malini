import { jobSuggestionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-suggestions.aggregate.svelte';

export { loadJobSuggestionsCommand };

function loadJobSuggestionsCommand(): void {
	void (async () => {
		try {
			await jobSuggestionsAggregate.load();
		} catch (error) {
			console.error('[malini jobs] could not load job suggestions', error);
		}
	})();
}
