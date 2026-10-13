import type { ThemeMode } from '$lib/app/domain/appearance';
import { appearanceStore } from '$lib/app/infrastructure/stores/appearance.store.svelte';

class ThemeModeQuery {
	public readonly data: ThemeMode = $derived(appearanceStore.themeMode);
}

export const themeModeQuery = new ThemeModeQuery();
