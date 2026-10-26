import type { ReconcilerDecisionRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

class ReconcilerDecisionsAggregate {
	decisions = $state.raw<readonly ReconcilerDecisionRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const decisions = await jobsService.listDecisions();
		if (generation !== this.#generation) return;
		const loaded = new Set(decisions.map((decision) => decision.id));
		this.decisions = [
			...decisions,
			...this.decisions.filter((decision) => !loaded.has(decision.id)),
		];
	}

	apply(decision: ReconcilerDecisionRecord): void {
		this.decisions = [
			decision,
			...this.decisions.filter((existing) => existing.id !== decision.id),
		];
	}
}

export const reconcilerDecisionsAggregate = new ReconcilerDecisionsAggregate();
