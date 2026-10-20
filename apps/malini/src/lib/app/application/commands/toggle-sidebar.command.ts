import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';

export function toggleSidebarCommand(): void {
	sidebarCollapsedStore.toggle();
}
