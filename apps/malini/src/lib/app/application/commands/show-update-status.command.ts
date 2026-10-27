import type { UpdateStatus } from '$contract/events';
import { toggleSidebarCommand } from '$lib/app/application/commands/toggle-sidebar.command';
import { sidebarCollapsedStore } from '$lib/app/infrastructure/stores/sidebar-collapsed.store.svelte';
import { updateStatusStore } from '$lib/app/infrastructure/stores/update-status.store.svelte';

export function showUpdateStatusCommand(status: UpdateStatus): void {
	const asked = status.state === 'checking' || status.state === 'downloading';
	if (asked && sidebarCollapsedStore.current && !sidebarCollapsedStore.overlayOpen) {
		toggleSidebarCommand();
	}
	updateStatusStore.observe(status);
}
