import { MAX_RECORDING_MS } from '$shared/sounds/domain/sounds';
import { microphone } from '$shared/sounds/infrastructure/services/microphone.service';
import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';
import { finishSoundRecordingCommand } from './finish-sound-recording.command';

export function startSoundRecordingCommand(): void {
	const session = soundRecorderStore.start();
	if (session === null) return;
	void (async () => {
		try {
			const stop = await microphone.record((level, elapsedMs) => {
				const live = soundRecorderStore.heard(session, level, elapsedMs);
				if (live && elapsedMs >= MAX_RECORDING_MS) finishSoundRecordingCommand();
			});
			if (!soundRecorderStore.recording(session, stop)) void stop(false);
		} catch (error) {
			soundRecorderStore.denied(session);
			console.error('[malini sounds] could not record from the microphone', error);
		}
	})();
}
