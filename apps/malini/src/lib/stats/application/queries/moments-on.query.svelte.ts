import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { momentsOnQuery };

class MomentsOnQuery {
	public readonly data: boolean = $derived(momentsStore.on);
}

const momentsOnQuery = new MomentsOnQuery();
