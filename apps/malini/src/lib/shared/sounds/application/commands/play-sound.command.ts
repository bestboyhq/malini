import { builtInSoundPath, NO_SOUND } from '$shared/sounds/domain/sounds';
import { soundPlayer } from '$shared/sounds/infrastructure/services/sound-player.service';
import { soundsService } from '$shared/sounds/infrastructure/services/sounds.service';
import { soundsStore } from '$shared/sounds/infrastructure/stores/sounds.store.svelte';

export function playSoundCommand(id: string): void {
	if (id === NO_SOUND) return;
	const path = builtInSoundPath(id);
	if (path) {
		soundPlayer.play(path);
		return;
	}
	void (async () => {
		try {
			const url = soundsStore.urlFor(id) ?? (await soundsService.customSoundUrl(id));
			soundsStore.keepUrl(id, url);
			soundPlayer.play(url);
		} catch (error) {
			console.error('[malini sounds] could not play your sound', error);
		}
	})();
}
