import type { ShareCard } from '$contract/stats';
import { shareCardAggregate } from '$lib/stats/infrastructure/aggregates/share-card.aggregate.svelte';

export { shareCardQuery };

class ShareCardQuery {
	public readonly data: ShareCard | null = $derived(shareCardAggregate.card);
}

const shareCardQuery = new ShareCardQuery();
