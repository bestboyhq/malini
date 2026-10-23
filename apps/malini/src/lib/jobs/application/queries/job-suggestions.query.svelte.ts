import type { JobSuggestionRecord } from '$contract/jobs';
import { jobSuggestionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-suggestions.aggregate.svelte';

export { jobSuggestionsQuery };

class JobSuggestionsQuery {
	public readonly data: readonly JobSuggestionRecord[] = $derived(
		[...jobSuggestionsAggregate.suggestions].sort(
			(left, right) =>
				right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
		),
	);
}

const jobSuggestionsQuery = new JobSuggestionsQuery();
