import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { composerDraftRestorationQuery };

class ComposerDraftRestorationQuery {
	public readonly data: (draftScope: string) => number = $derived(
		(draftScope: string) => composerSubmissionsStore.restorations[draftScope] ?? 0,
	);
}

const composerDraftRestorationQuery = new ComposerDraftRestorationQuery();
