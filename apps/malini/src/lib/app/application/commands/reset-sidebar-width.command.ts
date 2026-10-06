import { sidebarWidthStore } from '$lib/app/infrastructure/stores/sidebar-width.store.svelte';

export function resetSidebarWidthCommand(): void {
	sidebarWidthStore.reset();
}
