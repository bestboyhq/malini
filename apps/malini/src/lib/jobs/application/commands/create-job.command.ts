import type { SaveJobDefinitionArgs } from '$contract/jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import {
	jobActionsStore,
	NEW_JOB_ACTION_ID,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { createJobCommand };

function createJobCommand(job: Omit<SaveJobDefinitionArgs, 'id'>): void {
	void jobActionsStore.run(NEW_JOB_ACTION_ID, async () => {
		jobDefinitionsAggregate.upsert(await jobsService.saveDefinition(job));
	});
}
