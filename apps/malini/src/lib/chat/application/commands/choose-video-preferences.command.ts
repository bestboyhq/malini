import type { VideoPreferences } from '$lib/chat/domain/video-preferences';
import { videoPreferencesStore } from '$lib/chat/infrastructure/stores/video-preferences.store.svelte';

export function chooseVideoPreferencesCommand(change: Partial<VideoPreferences>): void {
	videoPreferencesStore.choose(change);
}
