import type { ShareCard } from '$contract/stats';
import { statsService } from '$lib/stats/infrastructure/services/stats.service';

class ShareCardAggregate {
	card = $state.raw<ShareCard | null>(null);

	#generation = 0;

	async load(): Promise<void> {
		const generation = ++this.#generation;
		const card = await statsService.shareCard();
		if (generation !== this.#generation) return;
		if (JSON.stringify(card) !== JSON.stringify(this.card)) this.card = card;
	}
}

export const shareCardAggregate = new ShareCardAggregate();
