import type { JobDefinitionRecord, JobRunsIn, JobTrigger } from '$contract/jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import {
	jobActionsStore,
	jobSettingsActionId,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { updateJobSettingsCommand };

type JobSettingsChange = Readonly<{
	trigger?: JobTrigger | null;
	thenJobId?: string | null;
	runsIn?: JobRunsIn;
}>;

function updateJobSettingsCommand(job: JobDefinitionRecord, change: JobSettingsChange): void {
	void jobActionsStore.run(jobSettingsActionId(job.id), async () => {
		jobDefinitionsAggregate.upsert(
			await jobsService.saveDefinition({
				id: job.id,
				name: job.name,
				instructions: job.instructions,
				model: job.model,
				effort: job.effort,
				runsIn: job.runsIn,
				skills: job.skills,
				...change,
			}),
		);
	});
}
