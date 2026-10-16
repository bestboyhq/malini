import type { StreamerMode } from '$lib/app/domain/streamer-mode';
import { streamerModeStore } from '$lib/app/infrastructure/stores/streamer-mode.store.svelte';

class StreamerModeQuery {
	public readonly mode: StreamerMode = $derived(streamerModeStore.mode);
	public readonly streaming: boolean = $derived(streamerModeStore.streaming);
}

export const streamerModeQuery = new StreamerModeQuery();
