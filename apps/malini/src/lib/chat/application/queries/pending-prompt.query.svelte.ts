import type { PendingUserPrompt } from '$lib/chat/domain/pending-prompt';
import type { SessionId } from '$lib/chat/domain/session';
import { pendingPromptStore } from '$lib/chat/infrastructure/stores/pending-prompt.store.svelte';

export { pendingPromptQuery };

class PendingPromptQuery {
	public readonly data: (sessionId: SessionId) => PendingUserPrompt | null = $derived(
		(sessionId: SessionId) => pendingPromptStore.for(sessionId),
	);
}

const pendingPromptQuery = new PendingPromptQuery();
