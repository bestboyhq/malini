import type { JobRunRecord } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { confirmJobRunCommand };

function confirmJobRunCommand(run: JobRunRecord): void {
	void jobActionsStore.run(run.id, async () => {
		jobRunsAggregate.apply(await jobsService.confirmRun(run.id));
	});
}
