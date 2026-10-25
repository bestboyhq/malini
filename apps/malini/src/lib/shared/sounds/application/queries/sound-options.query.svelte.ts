import {
	BUILT_IN_SOUNDS,
	customSoundOptions,
	type SoundOption,
} from '$shared/sounds/domain/sounds';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';

class SoundOptionsQuery {
	public readonly data: readonly SoundOption[] = $derived([
		...BUILT_IN_SOUNDS,
		...customSoundOptions(soundsStore.custom),
	]);
}

export const soundOptionsQuery = new SoundOptionsQuery();
