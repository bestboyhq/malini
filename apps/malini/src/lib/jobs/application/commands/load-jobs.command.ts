import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';

export { loadJobsCommand };

function loadJobsCommand(): void {
	void jobDefinitionsAggregate.load();
	void (async () => {
		try {
			await jobRunsAggregate.load();
		} catch (error) {
			console.error('[malini jobs] could not load job runs', error);
		}
	})();
}
