import { sidebarArchivedStore } from '$lib/app/infrastructure/stores/sidebar-archived.store.svelte';

export function resizeSidebarArchivedCommand(height: number): void {
	sidebarArchivedStore.resize(height);
}
