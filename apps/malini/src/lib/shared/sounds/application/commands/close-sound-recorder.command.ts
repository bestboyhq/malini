import { soundRecorderStore } from '$shared/sounds/infrastructure/stores/sound-recorder.store.svelte';

export function closeSoundRecorderCommand(): void {
	const stop = soundRecorderStore.takeStop();
	soundRecorderStore.close();
	if (stop) void stop(false);
}
