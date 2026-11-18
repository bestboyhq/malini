import type { VideoPreferences } from '$lib/chat/domain/video-preferences';
import { videoPreferencesStore } from '$lib/chat/infrastructure/stores/video-preferences.store.svelte';

class VideoPreferencesQuery {
	public readonly data: VideoPreferences = $derived(videoPreferencesStore.preferences);
}

export const videoPreferencesQuery = new VideoPreferencesQuery();
