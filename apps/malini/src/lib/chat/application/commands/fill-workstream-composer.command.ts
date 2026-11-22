import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { fillComposerCommand } from './fill-composer.command';

export { fillWorkstreamComposerCommand };

function fillWorkstreamComposerCommand(workstreamId: string, text: string): void {
	fillComposerCommand(agentDraftScopeKey(workstreamId, chatSessionStore.sessionId), text);
}
