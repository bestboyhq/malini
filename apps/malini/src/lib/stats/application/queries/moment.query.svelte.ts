import type { MomentCard } from '$contract/stats';
import { momentAggregate } from '$lib/stats/infrastructure/aggregates/moment.aggregate.svelte';
import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { momentQuery };

class MomentQuery {
	public readonly data: MomentCard | null = $derived(
		momentsStore.on &&
			momentAggregate.card &&
			!momentsStore.dismissed.includes(momentAggregate.card.moment.id)
			? momentAggregate.card
			: null,
	);
}

const momentQuery = new MomentQuery();
