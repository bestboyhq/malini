import type { TrimmedOutput } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class TrimmedOutputAggregate {
	trimmed = $state.raw<TrimmedOutput | null>(null);
	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const trimmed = await statsService.trimmedOutput();
		if (generation !== this.#generation) return;
		this.trimmed = trimmed;
	}
}

export const trimmedOutputAggregate = new TrimmedOutputAggregate();
