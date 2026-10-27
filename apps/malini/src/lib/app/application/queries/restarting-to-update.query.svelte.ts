import { updateStatusStore } from '$lib/app/infrastructure/stores/update-status.store.svelte';

class RestartingToUpdateQuery {
	public readonly data: boolean = $derived(updateStatusStore.restarting);
}

export const restartingToUpdateQuery = new RestartingToUpdateQuery();
