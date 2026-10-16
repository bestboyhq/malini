import type { StreamerMode } from '$lib/app/domain/streamer-mode';
import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';

export function chooseStreamerModeCommand(mode: StreamerMode): void {
	streamerModeStore.choose(mode);
}
