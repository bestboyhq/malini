import { momentsStore } from '$lib/stats/infrastructure/stores/moments.store.svelte';

export { switchMomentsCommand };

function switchMomentsCommand(on: boolean): void {
	momentsStore.switch(on);
}
