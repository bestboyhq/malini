import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { resetFreshSubmissionIntentCommand };

function resetFreshSubmissionIntentCommand(): void {
	composerSubmissionsStore.resetFreshIntent();
}
