import { toast } from '$hyper-ui/components/toast';
import { DEFAULT_SOUND_CHOICES, SOUND_SIGNALS } from '$shared/sounds/domain/sounds';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';
import { loadSoundsCommand } from './load-sounds.command';

export function removeCustomSoundCommand(id: string): void {
	const orphaned = SOUND_SIGNALS.filter((signal) => soundsStore.choices?.[signal] === id);
	for (const signal of orphaned) soundsStore.choose(signal, DEFAULT_SOUND_CHOICES[signal]);
	soundsStore.remove(id);
	void (async () => {
		try {
			await Promise.all(
				orphaned.map((signal) => soundsService.choose(signal, DEFAULT_SOUND_CHOICES[signal])),
			);
			await soundsService.remove(id);
		} catch (error) {
			toast.error(
				`Could not remove your sound · ${error instanceof Error ? error.message : String(error)}`,
			);
			loadSoundsCommand();
		}
	})();
}
