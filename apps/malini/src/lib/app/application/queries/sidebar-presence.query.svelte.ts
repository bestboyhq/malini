import { sidebarPresenceStore } from '$lib/app/infrastructure/stores/sidebar-presence.store.svelte';

class SidebarPresenceQuery {
	public readonly data: boolean = $derived(sidebarPresenceStore.current);
}

export const sidebarPresenceQuery = new SidebarPresenceQuery();
