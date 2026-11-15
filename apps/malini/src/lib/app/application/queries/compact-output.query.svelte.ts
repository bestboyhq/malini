import { compactOutputStore } from '$lib/app/infrastructure/stores/compact-output.store.svelte';

class CompactOutputQuery {
	public readonly on: boolean | null = $derived(compactOutputStore.on);
}

export const compactOutputQuery = new CompactOutputQuery();
