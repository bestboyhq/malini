import { sessionChangesStore } from '$lib/chat/infrastructure/stores/session-changes.store.svelte';

export { openingChangedFileQuery };

class OpeningChangedFileQuery {
	public readonly data: string | null = $derived(sessionChangesStore.openingPath);
}

const openingChangedFileQuery = new OpeningChangedFileQuery();
