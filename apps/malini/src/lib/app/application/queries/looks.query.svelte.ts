import type { Look } from '$lib/app/domain/look';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

class LooksQuery {
	public readonly data: readonly Look[] = $derived(appearanceStore.looks);
}

export const looksQuery = new LooksQuery();
