import { goto } from '$shared/router/navigation';
import { JOBS_HREF, jobHref } from '$shared/router/routes-hrefs';
import { page } from '$shared/router/state';
import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { deleteJobDefinitionCommand };

function deleteJobDefinitionCommand(definitionId: string): void {
	void jobActionsStore.run(definitionId, async () => {
		await jobsService.deleteDefinition(definitionId);
		jobDefinitionsAggregate.remove(definitionId);
		jobRunsAggregate.forgetDefinition(definitionId);
		if (page.url.pathname === jobHref(definitionId)) {
			await goto(JOBS_HREF, { replaceState: true });
		}
	});
}
