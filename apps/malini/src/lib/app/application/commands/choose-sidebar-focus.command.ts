import { chooseFocus, type SidebarFocus } from '$lib/app/domain/sidebar-focus';
import { sidebarFocusStore } from '$lib/app/infrastructure/stores/sidebar-focus.store.svelte';

export function chooseSidebarFocusCommand(focus: SidebarFocus): void {
	sidebarFocusStore.save(chooseFocus(sidebarFocusStore.state, focus));
}
