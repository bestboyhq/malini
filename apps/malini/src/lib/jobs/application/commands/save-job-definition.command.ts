import type { SaveJobDefinitionArgs } from '$contract/jobs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import {
	JOB_FORM_ACTION_ID,
	jobActionsStore,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { saveJobDefinitionCommand };

function saveJobDefinitionCommand(args: SaveJobDefinitionArgs): void {
	void jobActionsStore.run(JOB_FORM_ACTION_ID, async () => {
		jobDefinitionsAggregate.upsert(await jobsService.saveDefinition(args));
		jobActionsStore.noteSaved();
	});
}
