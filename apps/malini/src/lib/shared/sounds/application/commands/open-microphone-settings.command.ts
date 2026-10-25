import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';

export function openMicrophoneSettingsCommand(): void {
	void soundsService.openMicrophoneSettings().catch((error: unknown) => {
		console.error('[malini sounds] could not open the microphone settings', error);
	});
}
