import { toast } from '$hyper-ui/components/toast';
import { nextRecordingLabel, type SoundSignal } from '$shared/sounds/domain/sounds';
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
			if (recording) await keepRecording(signal, recording);
		} catch (error) {
			toast.error(couldNotKeep(error));
		}
	})();
}

async function keepRecording(signal: SoundSignal, recording: Blob): Promise<void> {
	try {
		const sound = await soundsService.add(
			nextRecordingLabel(soundsStore.custom),
			'recording',
			recording,
		);
		soundsStore.add(sound, URL.createObjectURL(recording));
		chooseSoundCommand(signal, sound.id);
	} catch (error) {
		toast.error(couldNotKeep(error), {
			ttlMs: null,
			action: { label: 'Try again', onclick: () => void keepRecording(signal, recording) },
		});
	}
}

function couldNotKeep(error: unknown): string {
	return `Could not keep your recording · ${error instanceof Error ? error.message : String(error)}`;
}
