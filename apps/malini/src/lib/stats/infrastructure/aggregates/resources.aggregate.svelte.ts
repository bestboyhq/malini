import type { ResourceSample } from '$contract/stats';
import { RESOURCE_HISTORY_MS } from '$lib/stats/domain/resources';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class ResourcesAggregate {
	samples = $state.raw<readonly ResourceSample[]>([]);
	machineMemoryBytes = $state.raw<number>(0);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const history = await statsService.resources();
		if (generation !== this.#generation) return;
		this.machineMemoryBytes = history.machineMemoryBytes;
		this.samples = history.samples;
	}

	append(sample: ResourceSample): void {
		const horizon = sample.sampledAt - RESOURCE_HISTORY_MS;
		this.samples = [
			...this.samples.filter(
				(kept) => kept.sampledAt > horizon && kept.sampledAt < sample.sampledAt,
			),
			sample,
		];
	}
}

export const resourcesAggregate = new ResourcesAggregate();
