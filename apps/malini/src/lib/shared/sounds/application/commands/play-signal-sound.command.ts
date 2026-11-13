import { toast } from '$hyper-ui/components/toast';
import { goto } from '$shared/router/navigation';
import { SOUND_SETTINGS_HREF } from '$shared/router/routes-hrefs';
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
			if (!sound) return;
			playSoundCommand(sound);
			if (signal === 'finished' && !soundsStore.noted) noteSounds();
		} catch (error) {
			console.error('[malini sounds] could not play the sound for this moment', error);
		}
	})();
}

const NOTE_MS = 12_000;

function noteSounds(): void {
	soundsStore.noted = true;
	toast.info('That sound means an agent finished. Another plays when one needs you.', {
		ttlMs: NOTE_MS,
		action: { label: 'Change sounds', onclick: () => void goto(SOUND_SETTINGS_HREF) },
	});
	void soundsService.note().catch((error: unknown) => {
		console.error('[malini sounds] could not remember the sounds note', error);
	});
}
