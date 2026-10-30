import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { dismissMomentCommand };

function dismissMomentCommand(id: string): void {
	momentsStore.dismiss(id);
}
