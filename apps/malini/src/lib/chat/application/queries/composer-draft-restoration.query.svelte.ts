import type { DraftRestoration } from '$lib/chat/domain/composer-submission-recovery';
import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { composerDraftRestorationQuery };

class ComposerDraftRestorationQuery {
	public readonly data: (draftScope: string) => DraftRestoration | null = $derived(
		(draftScope: string) => composerSubmissionsStore.restorations[draftScope] ?? null,
	);
}

const composerDraftRestorationQuery = new ComposerDraftRestorationQuery();
