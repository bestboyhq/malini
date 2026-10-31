import type { RecentMoments } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class MomentAggregate {
	recent = $state.raw<RecentMoments | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const recent = await statsService.moments();
		if (generation !== this.#generation || recent === null) return;
		if (JSON.stringify(recent) !== JSON.stringify(this.recent)) this.recent = recent;
	}
}

export const momentAggregate = new MomentAggregate();
