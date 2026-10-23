import { scorecardSince } from '$lib/jobs/domain/job-scorecard';
import { jobScorecardsAggregate } from '$lib/jobs/infrastructure/aggregates/job-scorecards.aggregate.svelte';

export { loadJobScorecardCommand };

function loadJobScorecardCommand(definitionId: string): void {
	void jobScorecardsAggregate.load(definitionId, scorecardSince(new Date()).toISOString());
}
