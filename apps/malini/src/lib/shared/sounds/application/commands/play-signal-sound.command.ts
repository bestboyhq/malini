import { playableSound, type SoundSignal } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';
import { playSoundCommand } from './play-sound.command';

export function playSignalSoundCommand(signal: SoundSignal): void {
	void (async () => {
		try {
			if (!soundsStore.choices) soundsStore.loaded(await soundsService.load());
			const choices = soundsStore.choices;
			if (!choices) return;
			const sound = playableSound(choices[signal], signal, soundsStore.custom);
			if (sound) playSoundCommand(sound);
		} catch (error) {
			console.error('[malini sounds] could not play the sound for this moment', error);
		}
	})();
}
