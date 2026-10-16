import type { SaveJobDefinitionArgs } from '$contract/jobs';
import { goto } from '$shared/router/navigation';
import { jobHref } from '$shared/router/routes-hrefs';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import {
	JOB_FORM_ACTION_ID,
	jobActionsStore,
} from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { createJobDefinitionCommand };

function createJobDefinitionCommand(args: Omit<SaveJobDefinitionArgs, 'id'>): void {
	void jobActionsStore.run(JOB_FORM_ACTION_ID, async () => {
		const created = await jobsService.saveDefinition(args);
		jobDefinitionsAggregate.upsert(created);
		jobActionsStore.noteSaved();
		await goto(jobHref(created.id), { replaceState: true });
	});
}
