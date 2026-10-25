import type { SoundRecorderState } from '$shared/sounds/domain/sounds';
import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';

class SoundRecorderQuery {
	public readonly data: SoundRecorderState | null = $derived(soundRecorderStore.state);
}

export const soundRecorderQuery = new SoundRecorderQuery();
