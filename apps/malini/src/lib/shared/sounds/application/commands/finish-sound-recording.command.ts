import { toast } from '$hyper-ui/components/toast';
import { nextRecordingLabel } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';
import { chooseSoundCommand } from './choose-sound.command';

export function finishSoundRecordingCommand(): void {
	const signal = soundRecorderStore.state?.signal;
	const stop = soundRecorderStore.takeStop();
	soundRecorderStore.close();
	if (!signal || !stop) return;
	void (async () => {
		try {
			const recording = await stop(true);
			if (!recording) return;
			const sound = await soundsService.add(
				nextRecordingLabel(soundsStore.custom),
				'recording',
				recording,
			);
			soundsStore.add(sound, URL.createObjectURL(recording));
			chooseSoundCommand(signal, sound.id);
		} catch (error) {
			toast.error(
				`Could not keep your recording · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
