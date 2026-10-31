import type { MomentCard } from '$contract/stats';
import { sensitiveMasking } from '$hyper-ui/components/sensitive';
import { unseenMoment } from '$lib/stats/domain/moments';
import { momentAggregate } from '$lib/stats/infrastructure/aggregates/moment.aggregate.svelte';
import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { momentQuery };

class MomentQuery {
	public readonly data: MomentCard | null = $derived.by(() => {
		const recent = momentAggregate.recent;
		if (!momentsStore.on || !recent || sensitiveMasking.on) return null;
		const moment = unseenMoment(recent.moments, momentsStore.dismissed);
		return moment ? { moment, card: recent.card } : null;
	});
}

const momentQuery = new MomentQuery();
