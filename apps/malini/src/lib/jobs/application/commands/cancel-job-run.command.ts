import type { JobRunRecord } from '$contract/jobs';
import { toast } from '$hyper-ui/components/toast';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { cancelJobRunCommand };

function cancelJobRunCommand(run: JobRunRecord): void {
	void jobActionsStore.run(run.id, async () => {
		try {
			jobRunsAggregate.apply(await jobsService.cancelRun(run.id));
		} catch (error) {
			toast.error(
				`Could not cancel ${run.title} · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});
}
