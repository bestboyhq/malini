import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';

class SidebarOverlayQuery {
	public readonly data: boolean = $derived(sidebarCollapsedStore.overlayOpen);
}

export const sidebarOverlayQuery = new SidebarOverlayQuery();
