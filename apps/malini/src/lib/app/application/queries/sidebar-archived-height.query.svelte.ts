import { sidebarArchivedStore } from '$lib/app/infrastructure/stores/sidebar-archived.store.svelte';

class SidebarArchivedHeightQuery {
	public readonly data: number = $derived(sidebarArchivedStore.height);
}

export const sidebarArchivedHeightQuery = new SidebarArchivedHeightQuery();
