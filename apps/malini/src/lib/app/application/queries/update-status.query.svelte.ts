import type { UpdateStatus } from '$contract/events';
import { updateStatusStore } from '$lib/app/infrastructure/stores/update-status.store.svelte';

class UpdateStatusQuery {
	public readonly data: UpdateStatus = $derived(updateStatusStore.status);
}

export const updateStatusQuery = new UpdateStatusQuery();
