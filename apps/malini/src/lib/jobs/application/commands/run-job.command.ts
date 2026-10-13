import type { RunJobArgs } from '$contract/jobs';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { runJobCommand };

function runJobCommand(args: RunJobArgs): void {
	void jobActionsStore.run(args.definitionId, async () => {
		jobRunsAggregate.apply(await jobsService.run({ ...args, origin: 'manual' }));
	});
}
