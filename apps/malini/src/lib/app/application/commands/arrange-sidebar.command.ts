import type { SidebarArrangement } from '$lib/app/domain/sidebar-arrangement';
import { sidebarArrangementStore } from '$lib/app/infrastructure/stores/sidebar-arrangement.store.svelte';

export function arrangeSidebarCommand(change: Partial<SidebarArrangement>): void {
	sidebarArrangementStore.save({ ...sidebarArrangementStore.arrangement, ...change });
}
