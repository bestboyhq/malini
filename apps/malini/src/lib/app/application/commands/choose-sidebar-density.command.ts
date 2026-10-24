import type { SidebarDensity } from '$lib/app/domain/sidebar-density';
import { sidebarDensityStore } from '$lib/app/infrastructure/stores/sidebar-density.store.svelte';

export function chooseSidebarDensityCommand(density: SidebarDensity): void {
	sidebarDensityStore.choose(density);
}
