import { toast } from '$hyper-ui/components/toast';
import { fileSoundLabel, type SoundSignal } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';
import { chooseSoundCommand } from './choose-sound.command';

export function addSoundFileCommand(signal: SoundSignal): void {
	void (async () => {
		try {
			const picked = await soundsService.pickFile();
			if (!picked) return;
			if (!(await soundsService.playable(picked.sound))) {
				toast.error(`Malini can’t play ${picked.name} · choose another sound file`);
				return;
			}
			const sound = await soundsService.add(fileSoundLabel(picked.name), 'file', picked.sound);
			soundsStore.add(sound, URL.createObjectURL(picked.sound));
			chooseSoundCommand(signal, sound.id);
		} catch (error) {
			toast.error(
				`Could not add your sound · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
