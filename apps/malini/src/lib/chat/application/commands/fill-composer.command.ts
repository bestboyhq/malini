import { agentDrafts } from '$lib/chat/infrastructure/aggregates/agent-drafts.aggregate.svelte';
import { composerSubmissionsStore } from '$lib/chat/infrastructure/stores/composer-submissions.store.svelte';

export { fillComposerCommand };

function fillComposerCommand(draftScope: string, text: string): void {
	agentDrafts.setText(draftScope, text);
	composerSubmissionsStore.markRestored(draftScope, 'filled');
}
