import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { resetJobDefinitionCommand };

function resetJobDefinitionCommand(definitionId: string): void {
	void jobActionsStore.run(definitionId, async () => {
		jobDefinitionsAggregate.upsert(await jobsService.resetDefinition(definitionId));
	});
}
