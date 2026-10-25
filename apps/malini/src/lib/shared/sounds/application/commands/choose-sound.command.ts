import { toast } from '$hyper-ui/components/toast';
import type { SoundSignal } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';
import { playSoundCommand } from './play-sound.command';

export function chooseSoundCommand(signal: SoundSignal, id: string): void {
	const previous = soundsStore.choices?.[signal];
	soundsStore.choose(signal, id);
	playSoundCommand(id);
	void (async () => {
		try {
			await soundsService.choose(signal, id);
		} catch (error) {
			if (previous) soundsStore.choose(signal, previous);
			toast.error(
				`Could not save your sound · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
