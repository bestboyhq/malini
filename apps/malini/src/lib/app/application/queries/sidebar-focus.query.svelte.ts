import type { SidebarFocusState } from '$lib/app/domain/sidebar-focus';
import { sidebarFocusStore } from '$lib/app/infrastructure/stores/sidebar-focus.store.svelte';

class SidebarFocusQuery {
	public readonly data: SidebarFocusState = $derived(sidebarFocusStore.state);
}

export const sidebarFocusQuery = new SidebarFocusQuery();
