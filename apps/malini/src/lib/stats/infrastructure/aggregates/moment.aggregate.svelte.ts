import type { MomentCard } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class MomentAggregate {
	card = $state.raw<MomentCard | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const card = await statsService.moment();
		if (generation !== this.#generation || card === null) return;
		if (JSON.stringify(card) !== JSON.stringify(this.card)) this.card = card;
	}
}

export const momentAggregate = new MomentAggregate();
