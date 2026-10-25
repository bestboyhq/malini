import type { SoundSignal } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';
import { closeSoundRecorderCommand } from './close-sound-recorder.command';

export function openSoundRecorderCommand(signal: SoundSignal): void {
	closeSoundRecorderCommand();
	soundRecorderStore.open(signal);
	void (async () => {
		try {
			soundRecorderStore.answered(signal, await soundsService.askForMicrophone());
		} catch (error) {
			soundRecorderStore.answered(signal, false);
			console.error('[malini sounds] could not ask for the microphone', error);
		}
	})();
}
