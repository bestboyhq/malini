import { MAX_RECORDING_MS } from '$shared/sounds/domain/sounds';
import { microphone } from '$shared/sounds/infrastructure/services/microphone.service';
import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';
import { finishSoundRecordingCommand } from './finish-sound-recording.command';

export function startSoundRecordingCommand(): void {
	if (soundRecorderStore.state?.phase !== 'ready') return;
	void (async () => {
		try {
			const stop = await microphone.record((level, elapsedMs) => {
				soundRecorderStore.heard(level, elapsedMs);
				if (elapsedMs >= MAX_RECORDING_MS) finishSoundRecordingCommand();
			});
			soundRecorderStore.recording(stop);
		} catch (error) {
			soundRecorderStore.denied();
			console.error('[malini sounds] could not record from the microphone', error);
		}
	})();
}
