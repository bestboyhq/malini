import { sidebarWidthStore } from '$lib/app/infrastructure/stores/sidebar-width.store.svelte';

export function resizeSidebarCommand(width: number, persist: boolean): void {
	sidebarWidthStore.set(width);
	if (persist) sidebarWidthStore.persist();
}
