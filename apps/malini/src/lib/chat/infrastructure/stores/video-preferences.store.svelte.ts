import { parseVideoPreferences, type VideoPreferences } from '$lib/chat/domain/video-preferences';

const STORAGE_KEY = 'malini.chat.video-preferences:v1';

class VideoPreferencesStore {
	preferences: VideoPreferences = $state.raw(load());

	choose(change: Partial<VideoPreferences>): void {
		this.preferences = { ...this.preferences, ...change };
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
		} catch {}
	}
}

function load(): VideoPreferences {
	try {
		return parseVideoPreferences(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null);
	} catch {
		return parseVideoPreferences(null);
	}
}

export const videoPreferencesStore = new VideoPreferencesStore();
