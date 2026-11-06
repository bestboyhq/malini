import type { ReconcilerDecisionRecord } from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

class ReconcilerDecisionsAggregate {
	decisions = $state.raw<readonly ReconcilerDecisionRecord[]>([]);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const decisions = await automationsService.listDecisions();
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
