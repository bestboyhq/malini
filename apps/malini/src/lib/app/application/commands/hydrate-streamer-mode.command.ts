import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';

export function hydrateStreamerModeCommand(): void {
	streamerModeStore.hydrate();
}
