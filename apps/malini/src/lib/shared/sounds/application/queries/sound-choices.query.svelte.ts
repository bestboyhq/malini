import { DEFAULT_SOUND_CHOICES, type SoundChoices } from '$shared/sounds/domain/sounds';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';

class SoundChoicesQuery {
	public readonly data: SoundChoices = $derived(soundsStore.choices ?? DEFAULT_SOUND_CHOICES);
}

export const soundChoicesQuery = new SoundChoicesQuery();
