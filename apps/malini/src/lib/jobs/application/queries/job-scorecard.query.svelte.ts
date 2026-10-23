import { isAutomaticJobBuiltin, type JobDefinitionRecord } from '$contract/jobs';
import { jobScorecard, type JobScorecard } from '$lib/jobs/domain/job-scorecard';
import { jobScorecardsAggregate } from '$lib/jobs/infrastructure/aggregates/job-scorecards.aggregate.svelte';

export { jobScorecardQuery };

class JobScorecardQuery {
	public readonly data: (definition: JobDefinitionRecord, nowMs: number) => JobScorecard | null =
		$derived((definition: JobDefinitionRecord, nowMs: number) => {
			const entities = jobScorecardsAggregate.entities[definition.id];
			if (!entities || !isAutomaticJobBuiltin(definition.builtin)) return null;
			return jobScorecard(definition.builtin, entities.outputs, entities.setups, new Date(nowMs));
		});
}

const jobScorecardQuery = new JobScorecardQuery();
