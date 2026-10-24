import type { SidebarDensity } from '$lib/app/domain/sidebar-density';
import { sidebarDensityStore } from '$lib/app/infrastructure/stores/sidebar-density.store.svelte';

class SidebarDensityQuery {
	public readonly data: SidebarDensity = $derived(sidebarDensityStore.density);
}

export const sidebarDensityQuery = new SidebarDensityQuery();
