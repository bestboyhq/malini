import type { Appearance } from '$lib/app/domain/appearance';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

class AppearanceQuery {
	public readonly data: Appearance = $derived(appearanceStore.appearance);
}

export const appearanceQuery = new AppearanceQuery();
