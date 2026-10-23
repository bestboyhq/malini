import type { JobOutputRecord, JobSetupRecord } from '$contract/jobs';
import { jobsService } from '$lib/jobs/infrastructure/services/jobs.service';

type ScorecardEntities = Readonly<{
	outputs: readonly JobOutputRecord[];
	setups: readonly JobSetupRecord[];
}>;

class JobScorecardsAggregate {
	entities = $state.raw<Readonly<Record<string, ScorecardEntities>>>({});
	loadErrors = $state.raw<Readonly<Record<string, string>>>({});

	#generations = new Map<string, number>();

	async load(definitionId: string, since: string): Promise<void> {
		const generation = (this.#generations.get(definitionId) ?? 0) + 1;
		this.#generations.set(definitionId, generation);
		try {
			const [outputs, setups] = await Promise.all([
				jobsService.listOutputs(definitionId, since),
				jobsService.listSetups(definitionId),
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

export const jobScorecardsAggregate = new JobScorecardsAggregate();
