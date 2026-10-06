import { sidebarPresenceStore } from '$lib/app/infrastructure/stores/sidebar-presence.store.svelte';

export function holdSidebarPresenceHook(): () => void {
	return sidebarPresenceStore.enter();
}
