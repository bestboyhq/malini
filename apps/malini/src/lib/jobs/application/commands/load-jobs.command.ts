import { jobDefinitionsAggregate } from '$lib/jobs/infrastructure/aggregates/job-definitions.aggregate.svelte';
import { jobRunsAggregate } from '$lib/jobs/infrastructure/aggregates/job-runs.aggregate.svelte';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';

export { loadJobsCommand };

function loadJobsCommand(): void {
	void jobDefinitionsAggregate.load();
	void (async () => {
		try {
			await Promise.all([jobRunsAggregate.load(), reconcilerDecisionsAggregate.load()]);
		} catch (error) {
			console.error('[malini jobs] could not load job runs', error);
		}
	})();
}
