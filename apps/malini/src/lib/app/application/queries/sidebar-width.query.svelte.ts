import { sidebarWidthStore } from '$lib/app/infrastructure/stores/sidebar-width.store.svelte';

class SidebarWidthQuery {
	public readonly data: number = $derived(sidebarWidthStore.current);
}

export const sidebarWidthQuery = new SidebarWidthQuery();
