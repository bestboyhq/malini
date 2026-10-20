import type { Theme } from '$lib/app/domain/appearance';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

class ThemeQuery {
	public readonly data: Theme = $derived(appearanceStore.theme);
}

export const themeQuery = new ThemeQuery();
