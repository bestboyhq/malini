import type { ActivityStats } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class ActivityAggregate {
	activity = $state.raw<ActivityStats | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const activity = await statsService.activity();
		if (generation !== this.#generation) return;
		this.activity = activity;
	}
}

export const activityAggregate = new ActivityAggregate();
