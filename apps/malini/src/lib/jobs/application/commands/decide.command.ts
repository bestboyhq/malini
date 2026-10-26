import type { ReconcilerDecisionRecord } from '$contract/jobs';
import { reconcilerDecisionsAggregate } from '$lib/jobs/infrastructure/aggregates/reconciler-decisions.aggregate.svelte';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';
import { jobActionsStore } from '$lib/jobs/infrastructure/stores/job-actions.store.svelte';

export { decideCommand };

function decideCommand(decision: ReconcilerDecisionRecord, candidate: number): void {
	void jobActionsStore.run(decision.id, async () => {
		reconcilerDecisionsAggregate.apply(await jobsService.decide(decision.id, candidate));
	});
}
