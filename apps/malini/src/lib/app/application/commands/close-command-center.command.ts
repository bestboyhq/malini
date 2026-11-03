import { commandCenterStore } from '$lib/app/infrastructure/stores/command-center.store.svelte';

export function closeCommandCenterCommand(): void {
	commandCenterStore.mode = null;
}
