import type { AutomationOutputRecord, AutomationSetupRecord } from '$contract/automations';
import { automationsService } from '$lib/automations/infrastructure/services/automations.service';

type ScorecardEntities = Readonly<{
	outputs: readonly AutomationOutputRecord[];
	setups: readonly AutomationSetupRecord[];
}>;

class AutomationScorecardsAggregate {
	entities = $state.raw<Readonly<Record<string, ScorecardEntities>>>({});
	loadErrors = $state.raw<Readonly<Record<string, string>>>({});

	#generations = new Map<string, number>();

	async load(definitionId: string, since: string): Promise<void> {
		const generation = (this.#generations.get(definitionId) ?? 0) + 1;
		this.#generations.set(definitionId, generation);
		try {
			const [outputs, setups] = await Promise.all([
				automationsService.listOutputs(definitionId, since),
				automationsService.listSetups(definitionId),
			]);
			if (this.#generations.get(definitionId) !== generation) return;
			this.entities = { ...this.entities, [definitionId]: { outputs, setups } };
			this.loadErrors = withoutKey(this.loadErrors, definitionId);
		} catch (error) {
			if (this.#generations.get(definitionId) !== generation) return;
			this.loadErrors = {
				...this.loadErrors,
				[definitionId]: error instanceof Error ? error.message : String(error),
			};
		}
	}
}

function withoutKey<Value>(
	record: Readonly<Record<string, Value>>,
	key: string,
): Readonly<Record<string, Value>> {
	return Object.fromEntries(Object.entries(record).filter(([existing]) => existing !== key));
}

export const automationScorecardsAggregate = new AutomationScorecardsAggregate();
