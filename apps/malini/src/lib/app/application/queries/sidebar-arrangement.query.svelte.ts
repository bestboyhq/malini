import type { SidebarArrangement } from '$lib/app/domain/sidebar-arrangement';
import { sidebarArrangementStore } from '$lib/app/infrastructure/stores/sidebar-arrangement.store.svelte';

class SidebarArrangementQuery {
	public readonly data: SidebarArrangement = $derived(sidebarArrangementStore.arrangement);
}

export const sidebarArrangementQuery = new SidebarArrangementQuery();
