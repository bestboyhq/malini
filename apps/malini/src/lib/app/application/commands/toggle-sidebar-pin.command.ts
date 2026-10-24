import { togglePinned, type SidebarFocus } from '$lib/app/domain/sidebar-focus';
import { sidebarFocusStore } from '$lib/app/infrastructure/stores/sidebar-focus.store.svelte';

export function toggleSidebarPinCommand(focus: SidebarFocus): void {
	sidebarFocusStore.save(togglePinned(sidebarFocusStore.state, focus));
}
