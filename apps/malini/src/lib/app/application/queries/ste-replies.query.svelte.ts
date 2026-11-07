import { steRepliesStore } from '$lib/app/infrastructure/stores/ste-replies.store.svelte';

class SteRepliesQuery {
	public readonly on: boolean | null = $derived(steRepliesStore.on);
}

export const steRepliesQuery = new SteRepliesQuery();
