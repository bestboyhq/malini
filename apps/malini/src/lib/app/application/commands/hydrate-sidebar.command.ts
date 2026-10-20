import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';
import { sidebarWidthStore } from '$lib/app/infrastructure/stores/sidebar-width.store.svelte';

export function hydrateSidebarCommand(): void {
	sidebarCollapsedStore.hydrate();
	sidebarWidthStore.hydrate();
}
