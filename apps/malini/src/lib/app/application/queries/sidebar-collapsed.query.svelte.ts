import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';

class SidebarCollapsedQuery {
	public readonly data: boolean = $derived(sidebarCollapsedStore.current);
}

export const sidebarCollapsedQuery = new SidebarCollapsedQuery();
