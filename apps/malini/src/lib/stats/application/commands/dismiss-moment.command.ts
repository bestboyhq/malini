import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { dismissMomentCommand };

function dismissMomentCommand(): void {
	momentsStore.dismiss();
}
