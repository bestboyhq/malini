import { jobScorecardsAggregate } from '$lib/jobs/infrastructure/aggregates/job-scorecards.aggregate.svelte';

export { jobScorecardErrorQuery };

class JobScorecardErrorQuery {
	public readonly data: (definitionId: string) => string | null = $derived(
		(definitionId: string) => jobScorecardsAggregate.loadErrors[definitionId] ?? null,
	);
}

const jobScorecardErrorQuery = new JobScorecardErrorQuery();
