import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { composerPendingSubmissionsQuery };

class ComposerPendingSubmissionsQuery {
	public readonly data: number = $derived(composerSubmissionsStore.pending);
}

const composerPendingSubmissionsQuery = new ComposerPendingSubmissionsQuery();
